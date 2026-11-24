// app/api/register.ts → /api/register, route name register.register
import { defineContract, endpoint } from "@laratype/contract";
import { RegisterBody, UserProfile } from "./_schemas";
import type { Prefix } from "./$types";

export default defineContract<Prefix>()({
  register: endpoint.post("/").body(RegisterBody).response(UserProfile),
});
