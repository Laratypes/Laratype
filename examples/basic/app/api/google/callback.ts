// app/api/google/callback.ts → /api/google/callback, route name google.callback.handleGoogleCallback
import { defineContract, endpoint } from "@laratype/contract";
import { CallbackResponse } from "../_schemas";
import type { Prefix } from "./$types";

export default defineContract<Prefix>()({
  handleGoogleCallback: endpoint.get("/").response(CallbackResponse),
});
