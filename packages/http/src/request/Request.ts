import type { Context } from "hono";
import { HonoRequest } from "hono/request"
import RequestSupport, { DEFAULT_RULES, HONO_CONTEXT } from "../supports/Request"
import ResponseKernel from "../response/Response";
import { resolveContractResponse } from "../response/contractResponse";
import type { KernelRouteParams, PolicyFactory, RouteParams } from "../contracts/Route";
import { AppServiceProvider, ContextApi, InternalException, MetaDataKey, ModelBindingRegistry, ModelManagement, NotFoundException, UnauthorizedException, ValidationException } from "@laratype/support"
import { FormValidation } from "@laratype/validation";
import type { MiddlewareClass } from "../routing/api/types";
import { Container, depsRegistry } from "@laratype/core";
import { validate } from "@laratype/contract";
import type { AnyEndpoint, StandardSchemaV1 } from "@laratype/contract";
import { publicIssue, readBody, readQuery, validateInput } from "./input";
import type { RawInput } from "./input";
import { isTypedMiddleware, middlewareName } from "../middleware/defineMiddleware";
import type { AnyTypedMiddleware } from "../middleware/defineMiddleware";

/** The Hono variable holding the request scope of the app container, set by `RequestKernel.boot()`. */
const CONTAINER = "laratype.container";

/**
 * A request path as one log line: Hono decodes the path, so `%0A` is a real newline and could break or forge a line in
 * the log (CWE-117). Control characters, C1 controls, the line separators and the bidi controls are escaped as
 * `\uXXXX`, and a backslash as `\\`, so a literal `\u000a` a client sent never reads as the escaped newline.
 */
const loggablePath = (path: string): string =>
  path.replace(/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069\\]/gu, (char) =>
    char === "\\" ? "\\\\" : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Created on first use, for routes served without `RequestKernel` (a bare Hono app). */
let fallbackContainer: Container | undefined;

/** Set once the fallback warning printed: per process, as dev restarts and a second copy of the module create another. */
const FALLBACK_WARNED = Symbol.for("laratype.http.fallbackContainerWarned");

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The own enumerable keys of an extension, symbol keys included: the keys `applyExtensions()` copies. */
const extensionKeys = (ext: object): PropertyKey[] =>
  Reflect.ownKeys(ext).filter((key) => Object.prototype.propertyIsEnumerable.call(ext, key));

/** The ctx keys of a contract route an extension cannot replace: the validated input and the pinned endpoint. */
const RESERVED_EXTENSION_KEYS: ReadonlySet<string> = new Set(["query", "body", "endpoint"]);

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
  handler: MiddlewareClass,
} | {
  type: 'typed-middleware',
  handler: AnyTypedMiddleware,
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
   * The container controllers, middleware and policies are resolved from: the request scope of the app container
   * `boot()` puts on each request, else one autowire-only container (outside `RequestKernel`, they are autowired
   * without app bindings).
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
    const registry = ModelBindingRegistry.current();
    
    for (const paramName in params) {
      let model = registry.bindings[paramName];
      if (!model) {
        const modelName = registry.paramModelMap?.[paramName];
        if(modelName) {
          model = registry.models?.[modelName];
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
  public static async contractContext({ endpoint, input }: { endpoint: AnyEndpoint, input: RawInput }, extensions: readonly object[] = []) {
    const { query, body } = await validateInput(endpoint, input);
    const ctx = this.applyExtensions({ params: input.params, query, body }, extensions);
    return Object.defineProperty(ctx, 'endpoint', { value: endpoint, writable: false, enumerable: false, configurable: false });
  }

  /**
   * Merges the context keys typed middleware passed to `next(ext)` into the handler argument (docs/v1/http.md › Typed
   * middleware, H6 #117): a later middleware wins a key it also adds, and `params` is merged one level deep, as `Ctx`
   * merges it, so an extension adds a key next to the path params instead of dropping them. Own enumerable string and
   * symbol keys are copied; each is an own data property, never an assignment: an own `__proto__` key (JSON.parse,
   * `{ ['__proto__']: ... }`) then stays a field of the ctx instead of swapping its prototype, and no inherited setter
   * runs for another key.
   */
  private static applyExtensions<T extends object>(arg: T, extensions: readonly object[]): T {
    const target = arg as Record<PropertyKey, unknown>;
    for (const ext of extensions) {
      for (const key of extensionKeys(ext)) {
        const value = (ext as Record<PropertyKey, unknown>)[key];
        const params = target.params;
        const merged = key === "params" && isObject(value) && isObject(params) ? { ...params, ...value } : value;
        Object.defineProperty(target, key, { value: merged, writable: true, enumerable: true, configurable: true });
      }
    }
    return arg;
  }

  /**
   * Rejects an extension key that would replace something the route owns (docs/v1/http.md › Typed middleware ›
   * Diagnostics): `query`, `body` and `endpoint` of a contract route, whose ctx keeps the validated input and the pinned
   * endpoint, and a request method on a route without a contract, whose extensions are applied onto the 0.5 request
   * object (`next({ param })` would replace `request.param`).
   */
  private static checkExtension(ext: object, name: string, request: RequestSupport, contract: boolean): void {
    for (const key of extensionKeys(ext)) {
      if (contract) {
        if (typeof key === "string" && RESERVED_EXTENSION_KEYS.has(key)) {
          throw new TypeError(
            `[@laratype/http] typed middleware ${name} passed ${key} to next(): \`${key}\` is reserved on a contract route (the validated query and body, and the endpoint)`,
          );
        }
      } else if (typeof (request as unknown as Record<PropertyKey, unknown>)[key] === "function") {
        throw new TypeError(
          `[@laratype/http] typed middleware ${name} passed ${String(key)} to next(): it is a method of the request, and the extension would replace it`,
        );
      }
    }
  }

  public static async pipeline(requestInstance: RequestSupport, pipelines: PipeLineType[], routeOption: KernelRouteParams, res: Response) {
    if(pipelines.length) {
      const pipeline = async () => {
        let index = 0;
        let error: any;
        // What the handler gets: the 0.5 request, or the ctx of a contract route
        let handlerArg: unknown = requestInstance;
        // What typed middleware passed to next(ext), merged into the handler argument once the request step runs
        const extensions: object[] = [];
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
                ? await this.contractContext(currentPipeline.contract, extensions)
                : this.applyExtensions(await this.processValidation(requestInstance, routeOption), extensions);
              return await next(arg);
            }
            else if(currentPipelineType === 'controller') {
              if(routeOption.controller) {
                return await this.controllerKernel(routeOption.controller)(handlerArg)
              }
              // An ad-hoc route (`r.get('/health', () => 'ok')`, H12 #139) has no contract: its handler gets the 0.5
              // request and the raw path params (no model binding), not the ctx of a contract handler
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
                const registry = ModelBindingRegistry.current();
                const modelName = registry.paramModelMap?.[modelPolicy];
                if(modelName) {
                  modelPolicy = registry.models?.[modelName];
                }
              }
              
              const policy = Reflect.getMetadata(MetaDataKey.POLICY, modelPolicy);
              if(!policy) {
                throw new InternalException(`Policy not found for model ${policyHandler.modelPolicy}`);
              }
              // Constructor DI (H21 #269): the policy comes from the request's container, as the controller does
              const allowed = await policyHandler.handle(policyHandler.ability, Request.container().make(policy), ...modelArgs);
              // A policy handler allows a request explicitly: any other result, `undefined` from a custom one included,
              // answers 401 rather than running the controller
              if(allowed !== true) {
                throw new UnauthorizedException();
              }
              return await next(arg);
            }
            else if(currentPipelineType === 'typed-middleware') {
              const middleware = currentPipeline.handler;
              const name = middlewareName(middleware);
              // One run of the rest of the pipeline per middleware: a second next() would advance the shared index again
              // and run the controller a second time (H6 #117)
              let called = false;
              return await middleware.handle(requestInstance, async (ext): Promise<unknown> => {
                if(called) {
                  throw new TypeError(`[@laratype/http] typed middleware ${name} called next() more than once`);
                }
                called = true;
                if(ext !== undefined) {
                  if(!isObject(ext)) {
                    throw new TypeError(`[@laratype/http] typed middleware ${name} passed ${typeof ext} to next(): pass an object of context keys, or call next()`);
                  }
                  this.checkExtension(ext, name, requestInstance, routeOption.endpoint !== undefined);
                  extensions.push(ext);
                }
                return await next(arg);
              });
            }
            else {
              // Constructor DI (H21 #269): the middleware comes from the request's container, as the controller does
              const middleware = Request.container().make(currentPipeline.handler);
              // A subclass that redeclares the 0.5 field (`protected previousResult!: T`) gets an own property under
              // define semantics (sauf's SWC, esbuild), which hides the request-local accessor: fail closed (H21 #269)
              if(Object.hasOwn(middleware, "previousResult")) {
                throw new InternalException(
                  `[@laratype/http] ${middleware.constructor.name} declares previousResult as a class field, which hides the request-local previous result. Fix: remove the field, use \`declare\`, or type it through Middleware<T>.`
                );
              }
              // The same instance can be mounted at more than one level (a container singleton at group and route
              // level): each run restores the value it found, so an inner run leaves no result behind for the outer
              // one to read after `next()` (H21 #269)
              const previousResult = middleware.getPreviousResult();
              middleware.setPreviousResult(arg);
              try {
                return await middleware.handle(requestInstance, res, next);
              } finally {
                middleware.setPreviousResult(previousResult);
              }
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
          // Order is the route's: a 0.5 class, or a typed middleware whose next(ext) extends the handler ctx (H6 #117)
          pipelines.push(...routeOption.middleware.map(m => isTypedMiddleware(m)
            ? { type: 'typed-middleware' as const, handler: m }
            : { type: 'middleware' as const, handler: m }));
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

  /** Disposals `boot()` started that have not settled yet; `settled()` awaits them. */
  protected readonly disposals = new Set<Promise<void>>();

  /**
   * Fresh route bindings per app boot (an HMR restart boots again): they do not outlive the previous app. Cleared in
   * `register()`, which runs before the app providers' (bootstrap lists RequestKernel first), so a `Route.bind()` from
   * an app provider's `register()` or `boot()` is kept. Only the bindings are cleared: the models and the param map
   * `DatabaseServiceProvider` fills stay.
   */
  public register(): void {
    this.app.make(ModelBindingRegistry).bindings = {};
  }

  public boot(): void {
    this.apps.use(async (ctx, next) => {
      // One request scope per request (D6 #112): request-scoped values are built in it and disposed once the handler
      // settles, without holding the response back: a slow or hung disposer must not delay or hang the response
      const scope = this.app.createRequestScope();
      (ctx.set as (key: string, value: Container) => void)(CONTAINER, scope);
      try {
        this.resolveRequest(ctx);
        return await next();
      } finally {
        this.disposeRequestScope(scope, ctx);
      }
    });
  }

  /**
   * @internal For tests only: resolves once every disposal this kernel started so far has settled, so a dispose test
   * doesn't depend on timing. Call it once the response has resolved: the middleware starts the disposal before it
   * returns, so a call earlier sees no disposal to wait for. A disposer that never settles keeps it pending, like the
   * request's own work.
   */
  public async settled(): Promise<void> {
    while (this.disposals.size) await Promise.all(this.disposals);
  }

  /**
   * The response is already resolved when this runs, so it is started, never awaited, and a failed disposal is logged
   * once, never turned into an error response. The rejection is handled on the promise itself, so it is never unhandled.
   */
  protected disposeRequestScope(scope: Container, ctx: Context): void {
    // Read before the disposal starts: the catch closure keeps only this line alive, not the whole context, while a
    // disposer hangs
    const label = `${ctx.req.method} ${loggablePath(ctx.req.path)}`;
    const disposal = scope.dispose().catch((error: unknown) => {
      console.error(`[@laratype/http] ${label}: disposing the request scope failed`, error);
    });
    this.disposals.add(disposal);
    // Dropped once settled, so `settled()` waits on the right ones and only running disposals stay in the set
    void disposal.then(() => this.disposals.delete(disposal));
  }
}
