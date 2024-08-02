import { Exception, Response, ServiceProvider } from "@laratype/core";

export default class ExceptionServiceProvider extends ServiceProvider {

  public register(): void {
    //@ts-ignore
    this.apps.onError((err, c) => {
      // Handle exceptions here
    })
  }
}