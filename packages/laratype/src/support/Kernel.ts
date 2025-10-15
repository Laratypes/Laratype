import { Context } from "hono";
import { AppServiceProvider } from "@laratype/support";


export default class Kernel extends AppServiceProvider {

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