// app/api/register.ts → /api/register, route name register.register
import { defineContract, endpoint } from "@laratype/contract";
import { RegisterBody, UserProfile } from "./_schemas";
import type { Prefix } from "./$types";

/** Public signup, rate-limited per client: a credential endpoint must not be an unlimited hashing oracle. */
export default defineContract<Prefix>()({
  register: endpoint.post("/").body(RegisterBody).throttle({ limit: 5, per: "1m" }).response(UserProfile),
});
