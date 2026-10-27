import type { Context } from "hono";
import { HonoRequest } from "hono/request"
import RequestSupport, { DEFAULT_RULES, HONO_CONTEXT } from "../supports/Request"
import ResponseKernel from "../response/Response";
import { resolveContractResponse } from "../response/contractResponse";
import type { KernelRouteParams, PolicyFactory, RouteParams } from "../contracts/Route";
import { AppServiceProvider, ContextApi, InternalException, MetaDataKey, ModelManagement, NotFoundException, ValidationException } from "@laratype/support"
import { FormValidation } from "@laratype/validation";
import Middleware from "../middleware/Middleware";
import { Container, depsRegistry } from "@laratype/core";
import { validate } from "@laratype/contract";
import type { AnyEndpoint, StandardSchemaV1 } from "@laratype/contract";
import { publicIssue, readBody, readQuery, validateInput } from "./input";
import type { RawInput } from "./input";

/** The Hono variable holding the app container, set by `RequestKernel.boot()`. */
const CONTAINER = "laratype.container";

/** Created on first use, for routes served without `RequestKernel` (a bare Hono app). */
let fallbackContainer: Container | undefined;

/** Set once the fallback warning printed: per process, as dev restarts and a second copy of the module create another. */
const FALLBACK_WARNED = Symbol.for("laratype.http.fallbackContainerWarned");

/** The autowire-only container, with a one-time dev warning (D9 #270): it ignores app bindings. Silent in production. */
const createFallbackContainer = () => {
  const store = globalThis as { [FALLBACK_WARNED]?: true };
  const prod = globalThis.__PROD__ ?? globalThis.process?.env?.NODE_ENV === "production";
  if (!prod && !store[FALLBACK_WARNED]) {
    store[FALLBACK_WARNED] = true;
    console.warn("[@laratype/http] No app container outside a RequestKernel request, so controllers (and RequestKernel.container()) use an autowire-only container: app bindings don't apply, and every request shares the singletons it autowires. Serve routes through RequestKernel to resolve them from the app container.");
  }
  return new Container({ deps: depsRegistry });
};

type PipeLineType = {
  type: 'middleware',
  handler: typeof Middleware,
} | {
  type: 'request',
  handler: RequestSupport,
  /** A contract route's endpoint and raw input, validated before the handler runs. */
  contract?: { endpoint: AnyEndpoint, input: RawInput },
} | {
  type: 'controller',
  handler: any,
} | {
  type: 'policies',
  handler: PolicyFactory,
};

export enum ControllerMethodHttpStatusCode {
  index = 200,
  show = 200,
  store = 201,
  update = 200,
  destroy = 204,
}

export default class Request extends AppServiceProvider {

  /** @deprecated The 0.5 `FormValidation` path: validate a Standard Schema with `validate()` from `@laratype/contract`. */
  public static async validate(data: any, rule: any) {
    const result = FormValidation.validationResult(rule, data);
    return result
  }

  /**
   * The container controllers are resolved from: the app container `boot()` puts on each request, else one
   * autowire-only container (outside `RequestKernel`, controllers are autowired without app bindings).
   */
  public static container(): Container {
    return ContextApi.getContainer() ?? (fallbackContainer ??= createFallbackContainer());
  }

  public static controllerKernel (c: NonNullable<RouteParams['controller']>) {
    // `arg`: the 0.5 request, or the ctx of a contract route
    return (arg: unknown) => {

      // Constructor DI (H2 #105): an unbound controller is autowired, a new instance per request as with `new`
      const controller = Request.container().make(c[0]) as any;
      const method = c[1]
      if(typeof controller[method] === "function") {
        // handle req
        return controller[method](arg, ContextApi.getModelBindings())
      }
      else
        console.error(`Invoke function expected: function, but got ${typeof controller[method]}`);
      
      throw new InternalException()
    }
  }

  public static transformRequest(request: HonoRequest, routeOption: KernelRouteParams) {
    if(routeOption.request) {
      return new routeOption.request(request);
    }
    return new RequestSupport(request)
  }

  public static explicitModelBinding(request: RequestSupport) {
    const res: Record<string, any> = {};
    const params = request.param();
    
    for (const paramName in params) {
      let model = globalThis.__laratype_route_model_bindings[paramName];
      if (!model) {
        const modelName = globalThis.__laratype_param_model_map?.[paramName];
        if(modelName) {
          model = globalThis.__laratype_db?.models?.[modelName];
        }
      }

      if(!model) continue;

      res[paramName] = {
        model,
        param: params[paramName]
      };
    }

    return res;
  }

  private static isModel(binding: any) {
    return (binding.model.constructor && binding.model.constructor.dataSource) || binding.model.dataSource;
  }

  public static async queryFromModelBinding(modelBindings: Record<string, any>) {
    const models = await Promise.all(
      Object.entries(modelBindings).map(async ([key, binding]) => {
        const isModel = this.isModel(binding);
        let modelInstance;
        if(isModel) {
          const modelClass = binding.model;
          const paramValue = binding.param;
          const primaryKey = ModelManagement.getPrimaryKeyFromModel(modelClass);
          if(!primaryKey) {
            throw new InternalException(`Model ${modelClass.name} does not have a primary key defined.`)
          }
          
          modelInstance = await modelClass.findOne({
            where: {
              [primaryKey]: paramValue
            }
          });
          
        }
        else {
          modelInstance = await binding.model(binding.param);
        }

        return [key, modelInstance];
      })
    )

    if(models.some(([, modelInstance]) => modelInstance === null)) {
      throw new NotFoundException("Requested resource not found.");
    }

    return Object.fromEntries(models);
  }

  /**
   * The 0.5 `input()`: the query merged with the body (`readBody`: JSON by media type, else form fields). `body` is
   * one `readBody()` already read, so the body is parsed once.
   */
  public static async processData(request: HonoRequest, body?: unknown) {
    request.input = {
      ...request.query(),
      ...(body === undefined ? await readBody(request) : body) as Record<string, any>,
    }
    
    return request;
  }

  /**
   * The handler context of a contract route (docs/v1/http.md › Controller typing: Ctx and ControllerOf): the raw path
   * params, and the query and body validated by the endpoint's schemas (their output). `endpoint` is a read-only,
   * non-enumerable own field, so spreading or logging the ctx doesn't copy the endpoint definition.
   */
  public static async contractContext({ endpoint, input }: { endpoint: AnyEndpoint, input: RawInput }) {
    const { query, body } = await validateInput(endpoint, input);
    const ctx = { params: input.params, query, body };
    return Object.defineProperty(ctx, 'endpoint', { value: endpoint, writable: false, enumerable: false, configurable: false });
  }

  public static async pipeline(requestInstance: RequestSupport, pipelines: PipeLineType[], routeOption: KernelRouteParams, res: Response) {
    if(pipelines.length) {
      const pipeline = async () => {
        let index = 0;
        let error: any;
        // What the handler gets: the 0.5 request, or the ctx of a contract route
        let handlerArg: unknown = requestInstance;
        const next = async (arg?: any) => {
          const currentPipeline = pipelines[index++];
          if(arg instanceof Error) {
            error ??= arg;
            return arg;
          }
          if (currentPipeline) {
            const currentPipelineType = currentPipeline.type;
            if(currentPipelineType === 'request') {
              handlerArg = currentPipeline.contract
                ? await this.contractContext(currentPipeline.contract)
                : await this.processValidation(requestInstance, routeOption);
              return await next(arg);
            }
            else if(currentPipelineType === 'controller') {
              if(routeOption.controller) {
                return await this.controllerKernel(routeOption.controller)(handlerArg)
              }
              // An ad-hoc route (`r.get('/health', () => 'ok')`, H12 #139) runs its handler as a controller method
              if('handler' in routeOption) {
                const { handler } = routeOption;
                return await handler(requestInstance, ContextApi.getModelBindings())
              }
              return await next(arg);
            }
            else if(currentPipelineType === "policies") {
              const policyHandler = currentPipeline.handler;
              const modelBindings = ContextApi.getModelBindings();

              const modelBinding = (model: any) => {
                if(typeof model === 'string') {
                  return modelBindings[model];
                }
                return model;
              }
              const modelArgs = policyHandler.args.map((arg: any) => modelBinding(arg));

              let modelPolicy = policyHandler.modelPolicy;
              if(typeof modelPolicy === 'string') {
                const modelName = globalThis.__laratype_param_model_map?.[modelPolicy];
                if(modelName) {
                  modelPolicy = globalThis.__laratype_db.models?.[modelName];
                }
              }
              
              const policy = Reflect.getMetadata(MetaDataKey.POLICY, modelPolicy);
              if(!policy) {
                throw new InternalException(`Policy not found for model ${policyHandler.modelPolicy}`);
              }
              await policyHandler.handle(policyHandler.ability, policy, ...modelArgs);
              return await next(arg);
            }
            else {
              const middleware = await new currentPipeline.handler();
              middleware.setPreviousResult(arg);
              return await middleware.handle(requestInstance, res, next);
            }
          }
        };
        const result = await next();

        return error ?? result;
      };
      return pipeline();
    }
  }

  public static async processValidation(requestInstance: RequestSupport, routeOption: KernelRouteParams) {
    // A request class that doesn't override rules() has nothing to validate: validated() keeps its default `{}`.
    // Told by the default's brand, not by prototype identity, which fails with two copies of @laratype/http (CJS, ESM)
    if(routeOption.request && (requestInstance.rules as { [DEFAULT_RULES]?: true })[DEFAULT_RULES] !== true) {
      // Only invalid input is a 422, with its field errors (#275). Anything thrown, by rules() or inside the schema (an
      // AggregateError, an ORM error, a nested parse), goes on to resolveException: a generic 500 and a server-side log
      const rules = requestInstance.rules() as StandardSchemaV1;
      if(typeof rules?.["~standard"]?.validate !== "function") {
        throw new TypeError(`${requestInstance.constructor.name}.rules() must return a Standard Schema (zod 3.25+, valibot, ...)`);
      }
      // The contract's adapter runs a zod schema once (safeParseAsync); the 422 lists `{ path, message }` only
      const result = await validate(rules, requestInstance.all());
      if(!result.ok) {
        throw new ValidationException({
          errors: result.issues.map(publicIssue),
        })
      }
      requestInstance.validated = () => result.value
    }

    return requestInstance
  }
  
  public static handle (routeOption: KernelRouteParams) {
    const { endpoint } = routeOption;
    // A contract route validates its endpoint's schemas: the rules() of a request class would be skipped silently
    if(endpoint && routeOption.request) {
      throw new TypeError(`${routeOption.name ?? routeOption.path}: a contract route validates its endpoint's query and body schemas, so it takes no request class (${routeOption.request.name})`);
    }
    return async (ctx: Context) => {
      const body = await readBody(ctx.req);
      const requestInstance = await this.processData(ctx.req, body);
      // A contract route's raw input: Hono builds a new params object per call; the query is read for a schema only
      const contract = endpoint && { endpoint, input: { params: ctx.req.param(), query: endpoint.def.query && readQuery(ctx.req), body } };
      const transformedRequest = this.transformRequest(requestInstance, routeOption);
      // For request.ip() (A5 #288). Non-enumerable, so logging or serializing the request doesn't walk Node's socket
      Object.defineProperty(transformedRequest, HONO_CONTEXT, { value: ctx, writable: false, enumerable: false, configurable: true });
      // The endpoint (#105) is also a read-only, non-enumerable field of the request, for middleware. A contract route
      // takes no request class, so the request has no own `endpoint` to clash with
      if(endpoint) {
        Object.defineProperty(transformedRequest, 'endpoint', { value: endpoint, writable: false, enumerable: false, configurable: false });
      }
      // Route.api routes get the raw path params: their model binding is r.bind (H7 #118), never a 0.5 lookup that
      // could run a query or answer an undeclared 404
      const res = routeOption.modelBinding === false
        ? { ...transformedRequest.param() }
        : await this.queryFromModelBinding(this.explicitModelBinding(transformedRequest));

      return ContextApi.run({
        request: transformedRequest,
        user: undefined,
        modelBindings: res,
        container: (ctx.get as (key: string) => Container | undefined)(CONTAINER),
      }, async () => {

        const pipelines: PipeLineType[] = [];
        if(routeOption.middleware?.length) {
          pipelines.push(...routeOption.middleware.map(m => ({ type: 'middleware' as const, handler: m })));
        }
        if(routeOption.can?.length) {
          pipelines.push(...routeOption.can.map(c => ({ type: 'policies' as const, handler: c })));
        }
        pipelines.push({ type: 'request' as const, handler: transformedRequest, contract });
        pipelines.push({ type: 'controller' as const, handler: 'controller' });

        const pipelineResult = await this.pipeline(transformedRequest, pipelines, routeOption, ctx.res);

        if(pipelineResult instanceof Error) {
          throw pipelineResult;
        }
        return routeOption.endpoint
          ? resolveContractResponse(ctx, pipelineResult, routeOption.endpoint, routeOption.name ?? routeOption.path)
          : ResponseKernel.resolveResponse(ctx, pipelineResult, routeOption);
      });
    }
  }

  public resolveRequest(request: Context) {
    console.log(`${request.req.method} - ${request.req.url}`);
  }

  public boot(): void {
    globalThis.__laratype_route_model_bindings = {};
    this.apps.use(async (ctx, next) => {
      (ctx.set as (key: string, value: Container) => void)(CONTAINER, this.app);
      this.resolveRequest(ctx);
      return next();
    });
  }
}
