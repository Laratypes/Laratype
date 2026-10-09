// Separate-repo FE: only generated types + slim manifest + the client package. No contracts, no zod.
import { manifest, type AppApi } from "../generated/api";
import { createManifestClient } from "../../client/manifest-client";
import { createPathClient } from "../../client/path-client";

export const api = createManifestClient<AppApi>(manifest, { baseUrl: "https://api.example.com" });
export const paths = createPathClient<AppApi>({ baseUrl: "https://api.example.com" });

export async function demo() {
  const shown = await api.users.show({ params: { user: "1" } });
  // @ts-expect-error params required (types survive generation)
  await api.users.show();
  const p = await paths.get("/users/:user/posts", { params: { user: "1" } });
  return [shown.ok && shown.data.email, p.ok && p.data[0]?.title];
}
