// app/api/login/manual.ts → /api/login/manual, route name login.manual.manualLogin
import { defineContract, endpoint } from "@laratype/contract";
import { InvalidCredentials } from "../_errors";
import { LoginBody, LoginResponse } from "../_schemas";
import type { Prefix } from "./$types";

/** Public login, rate-limited per client, like `/api/login`. */
export default defineContract<Prefix>()({
  manualLogin: endpoint
    .post("/")
    .body(LoginBody)
    .throttle({ limit: 5, per: "1m" })
    .throws(InvalidCredentials)
    .response(LoginResponse, 201),
});
