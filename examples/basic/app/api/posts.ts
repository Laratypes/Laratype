// app/api/posts.ts → /api/posts, route names posts.index and posts.store (docs/v1/contract.md › Contract folder tree)
import { defineContract, endpoint } from "@laratype/contract";
import type { Prefix } from "./$types";

export default defineContract<Prefix>()({
  index: endpoint.get("/"),
  store: endpoint.post("/"),
});
