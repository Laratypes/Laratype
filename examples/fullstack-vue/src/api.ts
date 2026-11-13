// The FE side of examples/basic: it imports contract files only (docs/v1/client.md › FE import rule), never the
// router, a controller or a model. `$types` inside those files resolves against the generated overlay in
// `.laratype/basic/types` (bun run types), not against examples/basic itself.
import { createClient } from "@laratype/client";
import { defineApi } from "@laratype/contract";
import type { ApiTypes } from "@laratype/contract";
import users from "../../basic/app/api/users";

/**
 * The API tree `sauf types:generate` would write as `$api` for examples/basic. Building it here keeps the FE program
 * on the contract files: the generated module lives outside `app/api`, which the FE boundary check excludes.
 */
export const appApi = defineApi({
  users: { contract: users, path: "/api/users", scopes: [] },
});

/** Same-origin `/api` calls: Vite proxies them to the examples/basic dev server (README). */
export const api = createClient(appApi);

export type User = ApiTypes<typeof appApi>["users"]["show"]["response"];
