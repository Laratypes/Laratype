import Controller from "../../core/controller/Controller";
import GeneralTypesEnum from "../../core/enum/GeneralTypesEnum";
import Request from "../../core/request/Request";
import { redirect, response } from "../../core/support/helpers";

export class BaseController extends Controller {
  
  public home (req: Request) {
    return {
      test: true,
    }
  }

  protected getDataType(dataType: string) {
    switch(dataType) {
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

  public testRawDataType (req: Request) {
    return this.getDataType(req.param("dataType"))
  } 
  
  public testCollectionDataType (req: Request) {
    return response(this.getDataType(req.param("dataType")))
  }
  
  public testRedirect (req: Request) {
    return redirect("/api/test/hello-world")
  }
  
  public helloWorld (req: Request) {
    return "Hello world"
  }

}
