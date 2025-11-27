import { controller, RouteOptions } from "@laratype/http";
import { AuthGuard, can } from "@laratype/auth";
import { GoogleAuthentication, LocalAuthentication, Web } from "../../src/http/middleware/Middleware";
import LoginController from "../../src/http/controllers/LoginController";
import UserController from "../..//src/http/controllers/UserController";
import CreateUserRequest from "../..//src/http/requests/CreateUserRequest";
import UpdateUserRequest from "../../src/http/requests/UpdateUserRequest";
import User from "../../src/models/User";
import LoginRequest from "../../src/http/requests/LoginRequest";

const authRoutes: RouteOptions = {
  path: "/",
  middleware: [
    Web,
  ],
  children: [
    {
      path: "/register",
      method: "post",
      request: CreateUserRequest,
      controller: controller(UserController, 'destroy')
    },
    {
      path: "/login",
      method: "post",
      controller: controller(LoginController, 'login'),
      middleware: [
        LocalAuthentication,
      ]
    },
    {
      path: "/login/manual",
      method: "post",
      controller: controller(LoginController, 'manualLogin'),
      request: LoginRequest,
    },
    {
      path: "/callback",
      method: "get",
      controller: controller(LoginController, 'handleGoogleLogin'),
      middleware: [
        GoogleAuthentication,
      ]
    },
    {
      path: "/google/callback",
      method: "get",
      controller: controller(LoginController, 'handleGoogleCallback'),
      middleware: [
        GoogleAuthentication,
      ]
    }
  ]
};

const authGuardedRoutes: RouteOptions = {
  path: "/",
  middleware: [
    Web,
    AuthGuard,
  ],
  children: [
    {
      path: "/users",
      controller: controller(UserController, 'store'),
      request: CreateUserRequest,
      method: "post",
      children: [
        {
          path: '',
          method: 'get',
          can: can("viewAny", User),
          controller: controller(UserController, 'index'),
        },
        {
          path: '/:user',
          method: 'get',
          can: can("view", "user"),
          controller: controller(UserController, 'view'),
        },
        {
          path: '/:activeUser',
          method: 'patch',
          request: UpdateUserRequest,
          controller: controller(UserController, 'update'),
        },
        {
          path: '/:id',
          method: 'delete',
          controller: controller(UserController, 'destroy'),
        }
      ]
    },
    {
      path: "/me",
      controller: controller(UserController, 'me'),
      method: "get"
    },
  ]
}

export default {
  path: '/',
  children: [
    authRoutes,
    authGuardedRoutes,
  ]
} satisfies RouteOptions