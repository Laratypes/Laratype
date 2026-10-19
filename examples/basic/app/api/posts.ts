// app/api/posts.ts → /api/posts, route names posts.index and posts.store (docs/v1/contract.md › Contract folder tree)
import { defineContract, endpoint } from "@laratype/contract";
import { z } from "zod";
import type { Prefix } from "./$types";

// An endpoint without a response schema answers 204 with no body: declare the responses these routes send
export default defineContract<Prefix>()({
  index: endpoint.get("/").response(z.object({ data: z.unknown() })),
  store: endpoint.post("/").response(z.object({}), 201),
});
