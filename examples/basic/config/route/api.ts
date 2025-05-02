import { RouteOptions } from "@laratype/http";
import { BaseController } from "../../src/controllers/BaseController";
import PostController from "../../src/controllers/PostController";
import UserController from "../../src/controllers/UserController";
import CreateUserRequest from "../../src/requests/CreateUserRequest";
import TestRequest from "../../src/requests/TestRequest";

export const baseRouteApi: RouteOptions = {
  path: "/test",
  middleware: [],
  controller: BaseController.prototype.__invoke('home'),
  request: TestRequest,
  method: "get",
  children: [
    {
      path: "/raw/:dataType",
      controller: BaseController.prototype.__invoke('testRawDataType'),
      method: "get"
    },
    {
      path: "/collection/:dataType",
      controller: BaseController.prototype.__invoke('testCollectionDataType'),
      method: "get"
    },
    {
      path: "/hello-world",
      controller: BaseController.prototype.__invoke('helloWorld'),
      method: "get"
    },
    {
      path: "/redirected",
      controller: BaseController.prototype.__invoke('testRedirect'),
      method: "get"
    },
    {
      path: "/users",
      controller: UserController.prototype.__invoke('store'),
      request: CreateUserRequest,
      method: "post",
      children: [
        {
          path: '',
          method: 'get',
          controller: UserController.prototype.__invoke('index'),
        }
      ]
    },
    {
      path: "/posts",
      controller: PostController.prototype.__invoke('store'),
      method: "post",
      children: [
        {
          path: '',
          method: 'get',
          controller: PostController.prototype.__invoke('index')
        }
      ]
    }
  ]
}