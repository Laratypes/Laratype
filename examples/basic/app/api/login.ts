// app/api/login.ts → /api/login, route name login.login
import { defineContract, endpoint } from "@laratype/contract";
import { InvalidCredentials } from "./_errors";
import { LoginBody, LoginResponse } from "./_schemas";
import type { Prefix } from "./$types";

export default defineContract<Prefix>()({
  login: endpoint.post("/").body(LoginBody).throws(InvalidCredentials).response(LoginResponse),
});
