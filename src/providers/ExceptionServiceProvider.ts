import Exception from "../../core/exception/Exception";
import ServiceProvider from "../../core/service/ServiceProvider";
import Response from "../../core/response/Response";

export default class ExceptionServiceProvider extends ServiceProvider {
  
  public register(): void {
      this.apps.onError((err, c) => {
        if(err instanceof Exception) {
          return Response.prototype.responseError(c, err, err.getHttpCode())
        }
        return Response.prototype.responseError(c, err, 500)
      })

  }
}