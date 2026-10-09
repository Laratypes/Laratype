// Option (b): path-style, type-only. No contract value reaches the bundle.
import type { AppApi } from "@app/contracts";
import type { ApiTypes } from "../../../contract";
import { createPathClient } from "../../client/path-client";

export const api = createPathClient<ApiTypes<AppApi>>({ baseUrl: "https://api.example.com" });

export async function demo() {
  const shown = await api.get("/users/:user", { params: { user: "1" } });
  const posts = await api.get("/users/:user/posts", { params: { user: "1" }, query: { q: "ts" } });
  const created = await api.post("/users/:user/posts", { params: { user: "1" }, body: { title: "t", body: "b" } });
  return [shown.ok && shown.data.name, posts.ok && posts.data.length, created.ok && created.data.id];
}
