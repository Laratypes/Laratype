import { Context } from "hono";
import { HonoRequest } from "hono/request"
import RequestSupport from "../supports/Request"
import ResponseKernel from "../response/Response";
import { RouteOptions, RouteParams } from "../contracts/Route";
import { InternalException, ServiceProvider, ValidationException } from "@laratype/support"
import { FormValidation } from "@laratype/validation";

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

  public static async processRequest(request: HonoRequest, routeOption: RouteOptions)
  {
    const requestInstance = await this.processData(request);
    return this.processValidation(requestInstance, routeOption);
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

  public static async processValidation(request: HonoRequest, routeOption: RouteOptions) {
    if(!request.input) {
      await this.processData(request);
    }
    const requestInstance = this.transformRequest(request, routeOption)
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
      const requestInstance = await this.processRequest(ctx.req, routeOption)
      const responseController = await this.controllerKernel(routeOption.controller)(requestInstance)
      return ResponseKernel.resolveResponse(ctx, responseController)
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