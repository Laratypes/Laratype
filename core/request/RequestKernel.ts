import { Context } from "hono";
import { RouteOptions } from "..";
import ValidationException from "../exception/ValidationException";
import FormValidation from "../validation/form/FormValidation";
import Request from "./Request"
import ServiceProvider from "../support/ServiceProvider";
import InternalException from "../exception/InternalException";
import ResponseKernel from "../response/ResponsiveKernel";

export default class RequestKernel extends ServiceProvider {
  protected static async process(c: Context, rule: any) {
    const req = await FormValidation.convertContext(c)
    await FormValidation.checkSchema(rule).run(req)
    return req;
  }

  public static async validate(c: Context, rule: any) {
    const request = await this.process(c, rule)
    const result = FormValidation.validationResult(request);
    return {
      isError: !result.isEmpty(),
      matchedData: FormValidation.matchedData(request),
      errors: result.array(),
    }
  }

  public static controllerKernel (c: NonNullable<RouteOptions['controller']>) {
    return (req: Request | undefined) => {
      
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
        const result = await this.validate(ctx, requestInstance.rules())
        if(result.isError) throw new ValidationException({
          errors: result.errors,
        })
        requestInstance.validate = () => result.matchedData
      }
      else requestInstance = new Request(ctx.req)
      // const requestTransformed = await this.transformRequest(ctx)
      const responseController = await this.controllerKernel(routeOption.controller)(requestInstance)
      return ResponseKernel.resolveResponse(ctx, responseController)
    }
  }

  public resolveRequest(request: Context) {
    console.log("Booting on kernel...");
  }

  public boot(): void {
    this.apps.use(async (ctx, next) => {
      this.resolveRequest(ctx);
      return next();
    });
  }
}