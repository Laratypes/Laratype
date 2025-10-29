import { RouteOptions } from "@laratype/http"
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
      controller: AdminRegisterController.__invoke('register'),
    },
    {
      path: "/login",
      method: "post",
      controller: AdminLoginController.__invoke('login'),
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
      controller: AdminHomeController.__invoke('me'),
    },
    {
      path: "/admins/:admin",
      method: "get",
      can: can('view', 'admin'),
      controller: AdminHomeController.__invoke('show'),
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
