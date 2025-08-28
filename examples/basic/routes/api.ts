import { RouteOptions } from "@laratype/http";
import { BaseController } from "../src/http/controllers/BaseController";
import PostController from "../src/http/controllers/PostController";
import UserController from "../src/http/controllers/UserController";
import CreateUserRequest from "../src/http/requests/CreateUserRequest";
import TestRequest from "../src/http/requests/TestRequest";
import { LoginController } from "../src/http/controllers/LoginController";
import { passport } from "@laratype/auth";
import { EnsureMiddlewareWorking, EnsureMiddlewareWorking2, Web } from "../src/http/middleware/Middleware";

export const baseRouteApi: RouteOptions = {
  path: "/test",
  middleware: [
    Web
  ],
  controller: BaseController.prototype.__invoke('home'),
  request: TestRequest,
  method: "get",
  children: [
    // {
    //   path: "/raw/:dataType",
    //   controller: BaseController.prototype.__invoke('testRawDataType'),
    //   method: "get"
    // },
    // {
    //   path: "/collection/:dataType",
    //   controller: BaseController.prototype.__invoke('testCollectionDataType'),
    //   method: "get"
    // },
    // {
    //   path: "/hello-world",
    //   controller: BaseController.prototype.__invoke('helloWorld'),
    //   method: "get"
    // },
    // {
    //   path: "/redirected",
    //   controller: BaseController.prototype.__invoke('testRedirect'),
    //   method: "get"
    // },
    // {
    //   path: "/users",
    //   controller: UserController.prototype.__invoke('store'),
    //   request: CreateUserRequest,
    //   method: "post",
    //   children: [
    //     {
    //       path: '',
    //       method: 'get',
    //       controller: UserController.prototype.__invoke('index'),
    //     }
    //   ]
    // },
    // {
    //   path: "/posts",
    //   controller: PostController.prototype.__invoke('store'),
    //   method: "post",
    //   children: [
    //     {
    //       path: '',
    //       method: 'get',
    //       controller: PostController.prototype.__invoke('index')
    //     }
    //   ]
    // },
    {
      path: '/passport',
      controller: LoginController.prototype.__invoke('loginWithGoogle'),
      method: "get",
      middleware: [
        EnsureMiddlewareWorking,
      ],
      withoutMiddleware: [
        Web,
      ],
      children: [
        {
          path: '/callback',
          method: "get",
          controller: LoginController.prototype.__invoke('handleGoogleCallback'),
          middleware: [
            EnsureMiddlewareWorking2,
          ]
        }
      ]
    }
  ]
}