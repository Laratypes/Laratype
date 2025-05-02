import { ServiceProvider } from "@laratype/support";

export default class ExceptionServiceProvider extends ServiceProvider {

  public register(): void {
    //@ts-ignore
    this.apps.onError((err, c) => {
      // Handle exceptions here
    })
  }
}