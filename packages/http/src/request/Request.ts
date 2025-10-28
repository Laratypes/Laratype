import { Context, Hono } from "hono";
import { HonoRequest } from "hono/request"
import RequestSupport from "../supports/Request"
import ResponseKernel from "../response/Response";
import { RouteOptions, RouteParams } from "../contracts/Route";
import { AppServiceProvider, ContextApi, InternalException, NotFoundException, ValidationException } from "@laratype/support"
import { FormValidation } from "@laratype/validation";
import Middleware from "../middleware/Middleware";

export default class Request extends AppServiceProvider {

  public static async validate(data: any, rule: any) {
    const result = FormValidation.validationResult(rule, data);
    return result
  }

  public static controllerKernel (c: NonNullable<RouteParams['controller']>) {
    return (req: RequestSupport | undefined) => {
      
      const controller = new (c[0] as any)();
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

  public static transformRequest(request: HonoRequest, routeOption: RouteOptions) {
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

  public static async queryFromModelBinding(modelBindings: Record<string, any>) {
    const models = await Promise.all(
      Object.entries(modelBindings).map(async ([key, binding]) => {
        const isModel = (binding.model.constructor && binding.model.constructor.dataSource) || binding.model.dataSource;
        let modelInstance;
        if(isModel) {
          const modelClass = binding.model;
          const paramValue = binding.param;
          const primaryKey = modelClass.getRepository().metadata.primaryColumns[0].propertyName;
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

  public static async pipeline(requestInstance: RequestSupport, pipelines: Array<(typeof Middleware) | RequestSupport | string>, routeOption: RouteOptions, res: Response) {
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
            if(currentPipeline instanceof RequestSupport) {
              await this.processValidation(requestInstance, routeOption);
              return await next(arg);
            }
            else if(typeof currentPipeline ==="string") {
              if(routeOption.controller) {
                return await this.controllerKernel(routeOption.controller)(requestInstance)
              }
              return await next(arg);
            }
            else {
              const middleware = await new currentPipeline();
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

  public static async processValidation(requestInstance: RequestSupport, routeOption: RouteOptions) {
    if(routeOption.request) {
      try {
        const result = await this.validate(requestInstance.all(), requestInstance.rules())
        requestInstance.validated = () => result
      }
      catch(e) {
          throw new ValidationException({
            //@ts-ignore
            errors: e.errors,
          })
      }
    }

    return requestInstance
  }
  
  public static handle (routeOption: RouteOptions) {
    return async (ctx: Context) => {
      const requestInstance = await this.processData(ctx.req);
      const transformedRequest = this.transformRequest(requestInstance, routeOption);
      const modelBindings = this.explicitModelBinding(transformedRequest);
      const res = await this.queryFromModelBinding(modelBindings);

      return ContextApi.run({
        request: transformedRequest,
        user: undefined,
        modelBindings: res,
      }, async () => {
        const pipelines = [
          ...routeOption.middleware ?? [],
          transformedRequest,
          "controller",
        ];

        const pipelineResult = await this.pipeline(transformedRequest, pipelines, routeOption, ctx.res);

        if(pipelineResult instanceof Error) {
          throw pipelineResult;
        }
        return ResponseKernel.resolveResponse(ctx, pipelineResult);
      });
    }
  }

  public resolveRequest(request: Context) {
    console.log(`${request.req.method} - ${request.req.url}`);
  }

  public boot(): void {
    globalThis.__laratype_route_model_bindings = {};
    this.apps.use(async (ctx, next) => {
      this.resolveRequest(ctx);
      return next();
    });
  }
}
