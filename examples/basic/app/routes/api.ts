import { Route } from "@laratype/http";
import { appApi } from "$api";
import { GoogleAuthentication } from "../http/middleware/Middleware";
import AdminHomeController from "../http/controllers/admin/AdminHomeController";
import AdminLoginController from "../http/controllers/admin/AdminLoginController";
import AdminRegisterController from "../http/controllers/admin/AdminRegisterController";
import GreetingController from "../http/controllers/GreetingController";
import LoginController from "../http/controllers/LoginController";
import PostController from "../http/controllers/PostController";
import RegisterController from "../http/controllers/RegisterController";
import UserController from "../http/controllers/UserController";
import Admin from "../models/Admin";
import AdminPolicy from "../policies/AdminPolicy";
import UserPolicy from "../policies/UserPolicy";
import { parseRouteId } from "../services/routeId";
import adminsContract from "../api/admin/admins";
import adminLoginContract from "../api/admin/login";
import adminMeContract from "../api/admin/me";
import adminRegisterContract from "../api/admin/register";
import callbackContract from "../api/callback";
import googleCallbackContract from "../api/google/callback";
import greetingContract from "../api/greeting";
import loginContract from "../api/login";
import manualLoginContract from "../api/login/manual";
import meContract from "../api/me";
import postsContract from "../api/posts";
import registerContract from "../api/register";
import usersContract from "../api/users";

// The ids a route may look an admin up by: a canonical safe integer. Anything else is a miss without a query, so
// `/api/admin/admins/abc` and an oversized id answer the contract's 404 instead of reaching the database.
const adminByRouteKey = async (raw: string) => {
  if (parseRouteId(raw) === null) return null;
  return Admin.findByRouteKey(raw);
};

// Contract routes: the URL comes from the app/api folder tree, so there is no prefix (docs/v1/http.md › Router v2)
export const apiRoutes = Route.api(appApi, (r) => [
  r.bind({ admin: adminByRouteKey }).contract(adminsContract, AdminHomeController, { policy: AdminPolicy }),
  r.contract(adminLoginContract, AdminLoginController),
  r.contract(adminMeContract, AdminHomeController, { policy: AdminPolicy }),
  r.contract(adminRegisterContract, AdminRegisterController, { policy: AdminPolicy }),
  r.contract(callbackContract, LoginController, { endpoints: { handleGoogleLogin: (r) => r.middleware(GoogleAuthentication) } }),
  r.contract(googleCallbackContract, LoginController, { endpoints: { handleGoogleCallback: (r) => r.middleware(GoogleAuthentication) } }),
  r.contract(greetingContract, GreetingController),
  r.contract(loginContract, LoginController),
  r.contract(manualLoginContract, LoginController),
  r.contract(meContract, UserController),
  r.contract(postsContract, PostController),
  r.contract(registerContract, RegisterController),
  r.contract(usersContract, UserController, { policy: UserPolicy }),
]);
