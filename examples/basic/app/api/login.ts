// app/api/login.ts → /api/login, route name login.login
import { defineContract, endpoint } from "@laratype/contract";
import { InvalidCredentials } from "./_errors";
import { LoginBody, LoginResponse } from "./_schemas";
import type { Prefix } from "./$types";

/** Public login, rate-limited per client: a credential endpoint must not be an unlimited hashing oracle. */
export default defineContract<Prefix>()({
  login: endpoint
    .post("/")
    .body(LoginBody)
    .throttle({ limit: 5, per: "1m" })
    .throws(InvalidCredentials)
    .response(LoginResponse),
});
