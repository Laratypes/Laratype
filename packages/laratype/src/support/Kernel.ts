import { Context } from "hono";
import { ServiceProvider } from "@laratype/support";


export default class Kernel extends ServiceProvider {

  public resolveRequest(request: Context) {
    console.log("Booting on kernel...");
  }

  public resolveResponse(response: Response) {

  }

  public boot(): void {
    this.apps.use(async (ctx, next) => {
      this.resolveRequest(ctx);
      return next();
    });
  }
}