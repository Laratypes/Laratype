// Option (c), monorepo flavour: generated slim manifest (values) + types from `import type` of the contracts.
import { manifest, type Api } from "../generated/manifest";
import { createManifestClient } from "../../client/manifest-client";

export const api = createManifestClient<Api>(manifest, { baseUrl: "https://api.example.com" });

export async function demo() {
  const shown = await api.users.show({ params: { user: "1" } });
  const list = await api.users.index();
  return [shown.ok && shown.data.name, list.ok && list.data.length];
}
