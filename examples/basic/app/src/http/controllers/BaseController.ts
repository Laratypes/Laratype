import { Controller, Request, Response, response, redirect } from "@laratype/http";
import { ContentTypeEnum, GeneralTypesEnum } from "@laratype/support";

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
        // A returned string is text/plain (H41 #336): an HTML body is an explicit Response
        return response("Hello World").setContentType(ContentTypeEnum.HTML)
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
    const data = this.getDataType(req.param("dataType"))
    return data instanceof Response ? data : response(data)
  }

  public testRedirect(req: Request) {
    return redirect("/api/test/hello-world")
  }

  public helloWorld(req: Request) {
    console.log()
    return "Hello world"
  }

}
