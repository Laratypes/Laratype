// app/api/posts.ts → /api/posts, route names posts.index and posts.store (docs/v1/contract.md › Contract folder tree)
import { defineContract, endpoint } from "@laratype/contract";
import { PostList, PostStoreResponse } from "./_schemas";
import type { Prefix } from "./$types";

export default defineContract<Prefix>()({
  index: endpoint.get("/").response(PostList),
  store: endpoint.post("/").response(PostStoreResponse, 201),
});
