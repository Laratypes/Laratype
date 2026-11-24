// app/api/admin/register.ts → /api/admin/register, route name admin.register.register
import { defineContract, endpoint } from "@laratype/contract";
import { RegisterBody, AdminProfile } from "../_schemas";
import type { Prefix } from "./$types";

/** Public signup: `.public()` opts out of the admin scope's auth (the 0.5 route had no guard). */
export default defineContract<Prefix>()({
  register: endpoint.post("/").public().body(RegisterBody).response(AdminProfile),
});
