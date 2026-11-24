// app/api/login/manual.ts → /api/login/manual, route name login.manual.manualLogin
import { defineContract, endpoint } from "@laratype/contract";
import { InvalidCredentials } from "../_errors";
import { LoginBody, LoginResponse } from "../_schemas";
import type { Prefix } from "./$types";

export default defineContract<Prefix>()({
  manualLogin: endpoint.post("/").body(LoginBody).throws(InvalidCredentials).response(LoginResponse, 201),
});
