import { RouteOptions } from "@laratype/http";
import { AuthGuard, can } from "@laratype/auth";
import { GoogleAuthentication, LocalAuthentication, Web } from "../../src/http/middleware/Middleware";
import LoginController from "../../src/http/controllers/LoginController";
import UserController from "../..//src/http/controllers/UserController";
import CreateUserRequest from "../..//src/http/requests/CreateUserRequest";
import UpdateUserRequest from "../../src/http/requests/UpdateUserRequest";
import { User } from "../../src/models/User";
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
      controller: UserController.__invoke('store'),
    },
    {
      path: "/login",
      method: "post",
      controller: LoginController.__invoke('login'),
      middleware: [
        LocalAuthentication,
      ]
    },
    {
      path: "/login/manual",
      method: "post",
      controller: LoginController.__invoke('manualLogin'),
      request: LoginRequest,
    },
    {
      path: "/callback",
      method: "get",
      controller: LoginController.__invoke('handleGoogleLogin'),
      middleware: [
        GoogleAuthentication,
      ]
    },
    {
      path: "/google/callback",
      method: "get",
      controller: LoginController.__invoke('handleGoogleCallback'),
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
      controller: UserController.__invoke('store'),
      request: CreateUserRequest,
      method: "post",
      children: [
        {
          path: '',
          method: 'get',
          can: can("viewAny", User),
          controller: UserController.__invoke('index'),
        },
        {
          path: '/:user',
          method: 'get',
          can: can("view", "user"),
          controller: UserController.__invoke('view'),
        },
        {
          path: '/:activeUser',
          method: 'patch',
          request: UpdateUserRequest,
          controller: UserController.__invoke('update'),
        },
        {
          path: '/:id',
          method: 'delete',
          controller: UserController.__invoke('delete'),
        }
      ]
    },
    {
      path: "/me",
      controller: UserController.__invoke('me'),
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