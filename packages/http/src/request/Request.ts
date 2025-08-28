import { Context } from "hono";
import { HonoRequest } from "hono/request"
import RequestSupport from "../supports/Request"
import ResponseKernel from "../response/Response";
import { RouteOptions, RouteParams } from "../contracts/Route";
import { InternalException, ServiceProvider, ValidationException } from "@laratype/support"
import { FormValidation } from "@laratype/validation";
import Middleware from "../middleware/Middleware";

export default class Request extends ServiceProvider {

  public static async validate(data: any, rule: any) {
    const result = FormValidation.validationResult(rule, data);
    return result
  }

  public static controllerKernel (c: NonNullable<RouteParams['controller']>) {
    return (req: RequestSupport | undefined) => {
      
      const controller = new c[0].constructor
      const method = c[1]
      if(typeof controller[method] === "function") {
        // handle req
        return controller[method](req)
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

  public static async pipeline(requestInstance: RequestSupport, pipelines: Array<(typeof Middleware) | RequestSupport | string>, routeOption: RouteOptions) {
    if(pipelines.length) {
      const pipeline = async () => {
        let index = 0;
        const next = async () => {
          const currentPipeline = pipelines[index++];
          if (currentPipeline) {
            if(currentPipeline instanceof RequestSupport) {
              await this.processValidation(requestInstance, routeOption);
              return await next();
            }
            else if(typeof currentPipeline ==="string") {
              return await this.controllerKernel(routeOption.controller)(requestInstance)
            }
            else {
              return await new currentPipeline().handle(requestInstance, next);
            }
          }
        };
        return await next();
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
      const pipelines = [
        ...routeOption.middleware ?? [],
        transformedRequest,
        "controller",
      ];

      // ctx.laratypeRequest = requestInstance
      const pipelineResult = await this.pipeline(transformedRequest, pipelines, routeOption);

      return ResponseKernel.resolveResponse(ctx, pipelineResult)
    }
  }

  public resolveRequest(request: Context) {
    console.log(`${request.req.method} - ${request.req.url}`);
  }

  public boot(): void {
    this.apps.use(async (ctx, next) => {
      this.resolveRequest(ctx);
      return next();
    });
  }
}