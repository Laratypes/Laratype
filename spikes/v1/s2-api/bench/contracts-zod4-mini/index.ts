// FE entry point (S2): contracts only. Must never import routes, controllers, models or server packages.
import { defineApi } from "../../../contract";
import { users } from "./users";
import { posts } from "./posts";

export const appApi = defineApi({ users, posts });
export type AppApi = typeof appApi;
