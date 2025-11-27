import { controller, RouteOptions } from "@laratype/http"
import { AuthGuard, can } from "@laratype/auth"
import CreateAdminRequest from "../../src/http/requests/admin/CreateAdminRequest"
import { AdminLocalAuthentication, Web } from "../../src/http/middleware/Middleware"
import AdminRegisterController from "../../src/http/controllers/admin/AdminRegisterController"
import { AdminLoginController } from "../../src/http/controllers/admin/AdminLoginController"
import AdminHomeController from "../../src/http/controllers/admin/AdminHomeController"

const adminAuthRoutes : RouteOptions = {
  path: "/",
  children: [
    {
      path: "/register",
      method: "post",
      request: CreateAdminRequest,
      controller: controller(AdminRegisterController, 'register'),
    },
    {
      path: "/login",
      method: "post",
      controller: controller(AdminLoginController, 'login'),
      middleware: [
        AdminLocalAuthentication,
      ],
    }
  ]
}

const adminGuardRoutes: RouteOptions = {
  path: "/",
  middleware: [
    Web,
    AuthGuard,
  ],
  children: [
    {
      path: "/me",
      method: "get",
      controller: controller(AdminHomeController, 'me'),
    },
    {
      path: "/admins/:admin",
      method: "get",
      can: can('view', 'admin'),
      controller: controller(AdminHomeController, 'show'),
    }
  ]
}

export default {
  path: "/admin",
  children: [
    adminAuthRoutes,
    adminGuardRoutes,
  ]
} satisfies RouteOptions
