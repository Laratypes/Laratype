import type { User } from "../models/User";
import { defineMiddleware } from "../../lib/router";

export const auth = () => defineMiddleware<{ user: User }>(async (_ctx, next) => next({ user: undefined as unknown as User }));
export const tenant = () => defineMiddleware<{ tenantId: string }>(async (_ctx, next) => next({ tenantId: "t1" }));
