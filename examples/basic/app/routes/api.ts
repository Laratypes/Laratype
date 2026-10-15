import { Route, type RouteOptions } from "@laratype/http";
import { appApi } from "$api";
import posts from "../api/posts";
import PostController from "../src/http/controllers/PostController";
import userRoutes from "./user/user";
import adminRoutes from "./admin/admin";

// Contract routes: the URL comes from the app/api folder tree, so there is no prefix (docs/v1/http.md › Router v2)
export const apiRoutes = Route.api(appApi, (r) => [
  r.contract(posts, PostController),
]);

// 0.5 routes, not migrated yet
export const baseRouteApi: RouteOptions[] = [
  userRoutes,
  adminRoutes,
];
