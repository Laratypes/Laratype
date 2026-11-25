// app/api/callback.ts → /api/callback, route name callback.handleGoogleLogin
import { defineContract, endpoint } from "@laratype/contract";
import { CallbackResponse } from "./_schemas";
import type { Prefix } from "./$types";

export default defineContract<Prefix>()({
  handleGoogleLogin: endpoint.get("/").response(CallbackResponse),
});
