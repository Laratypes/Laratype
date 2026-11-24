// app/api/admin/login.ts → /api/admin/login, route name admin.login.login
import { defineContract, endpoint } from "@laratype/contract";
import { InvalidCredentials } from "../_errors";
import { AdminLoginResponse, LoginBody } from "../_schemas";
import type { Prefix } from "./$types";

/** Public login: `.public()` opts out of the admin scope's auth (the 0.5 route had no AuthGuard). */
export default defineContract<Prefix>()({
  login: endpoint.post("/").public().body(LoginBody).throws(InvalidCredentials).response(AdminLoginResponse),
});
