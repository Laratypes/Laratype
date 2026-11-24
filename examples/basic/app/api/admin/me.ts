// app/api/admin/me.ts → /api/admin/me, route name admin.me.me
import { defineContract, endpoint } from "@laratype/contract";
import { AdminProfile } from "../_schemas";
import type { Prefix } from "./$types";

/**
 * The admin scope supplies `auth: 'admin'`. The endpoint also runs `AdminPolicy.me`: its `before` refuses a User
 * actor, so the policy chain keeps the 0.5 `AdminPolicy.before` rule as defence in depth.
 */
export default defineContract<Prefix>()({
  me: endpoint.get("/").authorize().response(AdminProfile),
});
