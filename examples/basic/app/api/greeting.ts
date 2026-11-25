// app/api/greeting.ts → /api/greeting, route name greeting.show
import { defineContract, endpoint } from "@laratype/contract";
import { GreetingResponse } from "./_schemas";
import type { Prefix } from "./$types";

export default defineContract<Prefix>()({
  show: endpoint.get("/").response(GreetingResponse),
});
