import { RouteOptions } from "@laratype/http";
import userRoutes from "./user/user";
import adminRoutes from "./admin/admin";

export const baseRouteApi: RouteOptions[] = [
  userRoutes,
  adminRoutes,
];
