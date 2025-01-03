import { Context } from "hono";
import RequestSupport from "../supports/Request"
import ResponseKernel from "../response/Response";
import { RouteOptions, RouteParams } from "../contracts/Route";
import { InternalException, ServiceProvider, ValidationException } from "@laratype/support"
import { FormValidation } from "@laratype/validation";

export default class Request extends ServiceProvider {
  protected static async process(c: Context) {
    const req = await FormValidation.convertContext(c)
    return req;
  }

  public static async validate(c: Context, rule: any) {
    const request = await this.process(c)
    const result = FormValidation.validationResult(rule, request);
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

  public static async transformRequest(request: Context) {

  }
  
  public static handle (routeOption: RouteOptions) {
    return async (ctx: Context) => {
      let requestInstance
      if(routeOption.request) {
        requestInstance = new routeOption.request(ctx.req);
        try {
          const result = await this.validate(ctx, requestInstance.rules())
          requestInstance.validated = () => result
        }
        catch(e) {
          console.error(e);
            throw new ValidationException({
              //@ts-ignore
              errors: e.errors,
            })
        }
      }
      else requestInstance = new RequestSupport(ctx.req)
      // const requestTransformed = await this.transformRequest(ctx)
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