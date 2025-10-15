import { RouteOptions } from "@laratype/http";
import { BaseController } from "../src/http/controllers/BaseController";
import PostController from "../src/http/controllers/PostController";
import UserController from "../src/http/controllers/UserController";
import CreateUserRequest from "../src/http/requests/CreateUserRequest";
import TestRequest from "../src/http/requests/TestRequest";
import { LoginController } from "../src/http/controllers/LoginController";
import { passport } from "@laratype/auth";
import { EnsureMiddlewareWorking, EnsureMiddlewareWorking2, GoogleAuthentication, LocalAuthentication, Web } from "../src/http/middleware/Middleware";
import RegisterController from "../src/http/controllers/RegisterController";

export const baseRouteApi: RouteOptions = {
  path: "/test",
  middleware: [
    Web
  ],
  controller: BaseController.__invoke('home'),
  request: TestRequest,
  method: "get",
  children: [
    // {
    //   path: "/raw/:dataType",
    //   controller: BaseController.__invoke('testRawDataType'),
    //   method: "get"
    // },
    // {
    //   path: "/collection/:dataType",
    //   controller: BaseController.__invoke('testCollectionDataType'),
    //   method: "get"
    // },
    {
      path: "/hello-world",
      controller: BaseController.__invoke('helloWorld'),
      method: "get"
    },
    // {
    //   path: "/redirected",
    //   controller: BaseController.__invoke('testRedirect'),
    //   method: "get"
    // },
    {
      path: "/users",
      controller: UserController.__invoke('store'),
      request: CreateUserRequest,
      method: "post",
      children: [
        {
          path: '',
          method: 'get',
          controller: UserController.__invoke('index'),
        }
      ]
    },
    // {
    //   path: "/posts",
    //   controller: PostController.__invoke('store'),
    //   method: "post",
    //   children: [
    //     {
    //       path: '',
    //       method: 'get',
    //       controller: PostController.__invoke('index')
    //     }
    //   ]
    // },
    {
      path: '/register',
      controller: RegisterController.__invoke('register'),
      method: "post",
      request: CreateUserRequest,
    },
    {
      path: '/passport',
      controller: LoginController.__invoke('loginWithGoogle'),
      method: "get",
      children: [
        {
          path: '/login',
          method: "post",
          controller: LoginController.__invoke('login'),
          middleware: [
            LocalAuthentication,
          ]
        },
        {
          path: '/callback',
          method: "get",
          controller: LoginController.__invoke('handleGoogleLogin'),
          middleware: [
            GoogleAuthentication,
          ]
        },
        {
          path: '/google/callback',
          method: "get",
          controller: LoginController.__invoke('handleGoogleCallback'),
          middleware: [
            GoogleAuthentication,
          ]
        }
      ]
    }
  ]
}