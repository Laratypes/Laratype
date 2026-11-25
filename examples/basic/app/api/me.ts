// app/api/me.ts → /api/me, route name me.me
import { defineContract, endpoint } from "@laratype/contract";
import { UserProfile } from "./_schemas";
import type { Prefix } from "./$types";

/** A contract option applies to every endpoint of the file. */
export default defineContract<Prefix>()({
  me: endpoint.get("/").response(UserProfile),
}, { auth: true });
