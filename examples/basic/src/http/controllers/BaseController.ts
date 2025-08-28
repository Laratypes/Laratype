import { Controller, Request, response, redirect, TrackingRequestGlobalStore } from "@laratype/http";
import { GeneralTypesEnum } from "@laratype/support";

export class BaseController extends Controller {

  public home(req: Request) {
    return {
      test: true,
    }
  }

  protected getDataType(dataType: string) {
    switch (dataType) {
      case "json":
        return {
          msg: "Hello world",
        }
      case "html":
        return "Hello World"
      case "array":
        return ["Hello", "World"]
      case "number":
        return 1
      default:
        return GeneralTypesEnum.NOTHING
    }
  }

  public testRawDataType(req: Request) {
    return this.getDataType(req.param("dataType"))
  }

  public testCollectionDataType(req: Request) {
    return response(this.getDataType(req.param("dataType")))
  }

  public testRedirect(req: Request) {
    return redirect("/api/test/hello-world")
  }

  public helloWorld(req: Request) {
    console.log()
    return "Hello world"
  }

}
