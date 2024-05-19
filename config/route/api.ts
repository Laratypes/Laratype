import { RouteOptions } from "../../core";
import { BaseController } from "../../src/controllers/BaseController";
import TestRequest from "../../src/requests/TestRequest";

export const baseRouteApi: RouteOptions = {
  path: "/test",
  middleware: [],
  controller: BaseController.prototype.__invoke('home'),
  request: TestRequest,
  method: "get",
}