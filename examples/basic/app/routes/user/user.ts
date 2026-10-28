import { controller, type RouteOptions } from "@laratype/http";
import { AuthGuard } from "@laratype/auth";
import { GoogleAuthentication, LocalAuthentication, Web } from "../../src/http/middleware/Middleware";
import LoginController from "../../src/http/controllers/LoginController";
import UserController from "../..//src/http/controllers/UserController";
import CreateUserRequest from "../..//src/http/requests/CreateUserRequest";
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
    // /api/users is the v1 contract's alone (app/api/users.ts, mounted in routes/api.ts): the 0.5 GET /api/users/:user,
    // PATCH /api/users/:activeUser and DELETE /api/users/:id children are gone (E1 #344). PATCH and DELETE on
    // /api/users now answer 404 until the v1 endpoints exist.
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