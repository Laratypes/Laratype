import { ControllerMethod } from "../../core";
import Controller from "../../core/controller/Controller";
import Request from "../../core/request/Request";
import { Context, Handler } from "hono";

export class BaseController extends Controller {
  
  public home: Handler = (c, req) => {
    return c.json({
      test: true,
    })
  }

}
