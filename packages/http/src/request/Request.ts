import type { Context } from "hono";
import { HonoRequest } from "hono/request"
import RequestSupport from "../supports/Request"
import ResponseKernel from "../response/Response";
import type { PolicyFactory, RouteParams } from "../contracts/Route";
import { AppServiceProvider, ContextApi, InternalException, MetaDataKey, ModelManagement, NotFoundException, ValidationException } from "@laratype/support"
import { FormValidation } from "@laratype/validation";
import Middleware from "../middleware/Middleware";
import { Container, depsRegistry } from "@laratype/core";
import { validate } from "@laratype/contract";
import type { StandardSchemaV1 } from "@laratype/contract";

/** The Hono variable holding the app container, set by `RequestKernel.boot()`. */
const CONTAINER = "laratype.container";

type RulesResult = { ok: true; value: any } | { ok: false; issues: unknown[] };

/**
 * Validates `rules()` once. A zod schema runs `safeParseAsync`: its Standard Schema `validate` catches an error thrown
 * by a refinement or transform and runs the whole schema again, async, so side effects would run twice. Its issues are
 * the 422 body as before. Any other Standard Schema runs `validate`, and its issues are cut to `{ path, message }`:
 * raw issues (valibot's) carry the whole `input` of the request. A message may still repeat the submitted value.
 */
const validateRules = async (rules: StandardSchemaV1 & { safeParseAsync?: unknown }, data: unknown): Promise<RulesResult> => {
  if(typeof rules.safeParseAsync === "function") {
    const parsed = await (rules.safeParseAsync as (data: unknown) => Promise<{ success: boolean; data?: unknown; error?: { issues: unknown[] } }>)(data);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, issues: parsed.error!.issues };
  }
  const result = await validate(rules, data);
  if(result.ok) {
    return { ok: true, value: result.value };
  }
  return {
    ok: false,
    issues: result.issues.map((issue) => ({
      path: (issue.path ?? []).map((segment) => (typeof segment === "object" ? segment.key : segment)),
      message: issue.message,
    })),
  };
};

/** Created on first use, for routes served without `RequestKernel` (a bare Hono app). */
let fallbackContainer: Container | undefined;

/** Set once the fallback warning printed: per process, as dev restarts and a second copy of the module create another. */
const FALLBACK_WARNED = Symbol.for("laratype.http.fallbackContainerWarned");

/** The autowire-only container, with a one-time dev warning (D9 #270): it ignores app bindings. Silent in production. */
const createFallbackContainer = () => {
  const store = globalThis as { [FALLBACK_WARNED]?: true };
  const prod = globalThis.__PROD__ || globalThis.process?.env?.NODE_ENV === "production";
  if (!prod && !store[FALLBACK_WARNED]) {
    store[FALLBACK_WARNED] = true;
    console.warn("[@laratype/http] Controllers are resolved outside a RequestKernel request, by an autowire-only container: app bindings don't apply, and singletons it autowires live for the whole process. Serve them through RequestKernel to resolve them from the app container.");
  }
  return new Container({ deps: depsRegistry });
};

type PipeLineType = {
  type: 'middleware',
  handler: typeof Middleware,
} | {
  type: 'request',
  handler: RequestSupport,
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
    return (req: RequestSupport | undefined) => {

      // Constructor DI (H2 #105): an unbound controller is autowired, a new instance per request as with `new`
      const controller = Request.container().make(c[0]) as any;
      const method = c[1]
      if(typeof controller[method] === "function") {
        // handle req
        return controller[method](req, ContextApi.getModelBindings())
      }
      else
        console.error(`Invoke function expected: function, but got ${typeof controller[method]}`);
      
      throw new InternalException()
    }
  }

  public static transformRequest(request: HonoRequest, routeOption: RouteParams) {
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

  public static async processData(request: HonoRequest) {
    switch(request.header('Content-Type')) {
      case 'application/json':
        request.input = await request.json()
        break;
      default:
        request.input = await request.parseBody({
          dot: true,
        })
    }

    request.input = {
      ...request.query(),
      ...request.input,
    }
    
    return request;
  }

  public static async pipeline(requestInstance: RequestSupport, pipelines: PipeLineType[], routeOption: RouteParams, res: Response) {
    if(pipelines.length) {
      const pipeline = async () => {
        let index = 0;
        let error: any;
        const next = async (arg?: any) => {
          const currentPipeline = pipelines[index++];
          if(arg instanceof Error) {
            error ??= arg;
            return arg;
          }
          if (currentPipeline) {
            const currentPipelineType = currentPipeline.type;
            if(currentPipelineType === 'request') {
              await this.processValidation(requestInstance, routeOption);
              return await next(arg);
            }
            else if(currentPipelineType === 'controller') {
              if(routeOption.controller) {
                return await this.controllerKernel(routeOption.controller)(requestInstance)
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

  public static async processValidation(requestInstance: RequestSupport, routeOption: RouteParams) {
    // A request class that doesn't override rules() has nothing to validate: validated() keeps its default `{}`
    if(routeOption.request && requestInstance.rules !== RequestSupport.prototype.rules) {
      // Only invalid input is a 422, with its field errors (#275). Anything thrown, by rules() or inside the schema (an
      // AggregateError, an ORM error, a nested parse), goes on to resolveException: a generic 500 and a server-side log
      const rules = requestInstance.rules() as StandardSchemaV1 & { safeParseAsync?: unknown };
      if(typeof rules?.["~standard"]?.validate !== "function") {
        throw new TypeError(`${requestInstance.constructor.name}.rules() must return a Standard Schema (zod 3.25+, valibot, ...)`);
      }
      const result = await validateRules(rules, requestInstance.all());
      if(!result.ok) {
        throw new ValidationException({
          errors: result.issues,
        })
      }
      requestInstance.validated = () => result.value
    }

    return requestInstance
  }
  
  public static handle (routeOption: RouteParams) {
    return async (ctx: Context) => {
      const requestInstance = await this.processData(ctx.req);
      const transformedRequest = this.transformRequest(requestInstance, routeOption);
      // Route.api routes get the raw path params: their model binding is r.bind (H7 #118), never a 0.5 lookup that
      // could run a query or answer an undeclared 404
      const res = routeOption.modelBinding === false
        ? { ...transformedRequest.param() }
        : await this.queryFromModelBinding(this.explicitModelBinding(transformedRequest));

      // ctx.endpoint (#105): a read-only field of this request's own object, for Route.api routes only
      if(routeOption.endpoint) {
        // A request class with its own `endpoint` field would keep that field's attributes (writable, enumerable)
        if(Object.hasOwn(transformedRequest, 'endpoint')) {
          throw new InternalException(`${routeOption.name ?? routeOption.path}: the request already has an own "endpoint" property, which ctx.endpoint (#105) reserves: rename that field of ${transformedRequest.constructor.name}`);
        }
        // Non-enumerable, so spreading or logging the request doesn't copy the endpoint definition
        Object.defineProperty(transformedRequest, 'endpoint', { value: routeOption.endpoint, writable: false, enumerable: false, configurable: false });
      }

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
        pipelines.push({ type: 'request' as const, handler: transformedRequest });
        pipelines.push({ type: 'controller' as const, handler: 'controller' });

        const pipelineResult = await this.pipeline(transformedRequest, pipelines, routeOption, ctx.res);

        if(pipelineResult instanceof Error) {
          throw pipelineResult;
        }
        return ResponseKernel.resolveResponse(ctx, pipelineResult, routeOption);
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
