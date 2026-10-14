---
area: client
packages: ["@laratype/client", "@laratype/client-query"]
issues: [85, 109, 110, 124, 132, 133, 140, 141, 159, 228]
verified-against: Laratype@d70daa7
last-verified: 2026-10-14
---

# Client (`@laratype/client`)

The typed FE client is driven by contracts. `createClient` is merged (CL1); the other sections are decided (S2) or planned. Signatures quoted from the S2 spike are a non-binding reference, not a spec.

Decision record: S2 [#85](https://github.com/Laratypes/Laratype/issues/85), [DECISIONS-S1-S2.md §S2](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s2-85-decision). Spike prototypes: `spikes/v1/s2-api/client/*` on PR #197 @ 4c558fd. The type side the client consumes (`ApiTypes`, `EndpointShape`, `ApiShape`) is in [contract.md › API type projection](./contract.md#api-type-projection).

| Section | Status |
|---|---|
| [Package scaffold](#package-scaffold) | merged @ d70daa7 |
| [FE import rule](#fe-import-rule) | decided (S2 #85); enforced by C5 fixtures, merged @ e2eac4b; generated entry merged ([#228](https://github.com/Laratypes/Laratype/issues/228), [#133](https://github.com/Laratypes/Laratype/issues/133)) |
| [createClient](#createclient) | merged ([#109](https://github.com/Laratypes/Laratype/issues/109)); result union planned → #110 |
| [Result union](#result-union) | planned → #110 |
| [Options and hooks](#options-and-hooks) | planned → #124 |
| [Path-style calls](#path-style-calls) | planned → #140 |
| [Separate-repo FE (generated manifest)](#separate-repo-fe-generated-manifest) | merged ([#133](https://github.com/Laratypes/Laratype/issues/133)); `createClient(manifest)` merged ([#109](https://github.com/Laratypes/Laratype/issues/109)) |
| [Bundle budget](#bundle-budget) | planned → #132 |
| [TanStack Query adapter](#tanstack-query-adapter) | planned → #141 |
| [Dev-mode response validation](#dev-mode-response-validation) | planned → #159 |

---

## Package scaffold

### Status
merged @ d70daa7 (S4 [#87](https://github.com/Laratypes/Laratype/issues/87)).

### Public API
[`client/src/index.ts` @ d70daa7](https://github.com/Laratypes/Laratype/blob/d70daa77bfceeb99bba44938431535908784a9ce/packages/client/src/index.ts)

```ts
export const PACKAGE_NAME = '@laratype/client' as const
```

### Invariants
- The package's only `@laratype/*` dependency will be `@laratype/contract`. It must stay browser-safe (no `node:*`).

### Diagnostics
None.

### Example
None yet.

### Non-goals
- No server code. No schema library as a dependency (the user chooses it).

### Open questions
- None recorded.

### Acceptance
[#87 Done when](https://github.com/Laratypes/Laratype/issues/87)

---

## FE import rule

### Status
Decided by S2 ([#85](https://github.com/Laratypes/Laratype/issues/85)). Enforced by the C5 FE fixtures, merged @ e2eac4b (`packages/contract/__tests__/fixtures/fe/*`, compiled with `types: []` and the DOM lib). The entry module is the generated `appApi`, merged ([#228](https://github.com/Laratypes/Laratype/issues/228), [#133](https://github.com/Laratypes/Laratype/issues/133)): the FE imports it from `$api` (`.laratype/api/index.gen.ts`) or imports a contract file from the [folder tree](./contract.md#contract-folder-tree). The rule itself (contracts only, never server code) is unchanged.

### Public API
None of its own. The FE entry is `.laratype/api/index.gen.ts`, written by `sauf types:generate` and imported as `$api`:

```ts
export const appApi = defineApi({ 'users': { contract, path, scopes }, 'users.posts': { ... } })   // see contract.md › defineApi
export type AppApi = typeof appApi
```

### Invariants
- The FE imports **only** `$api` (`appApi` / `AppApi`) or contract files, never `typeof routes`. In the S2 fixture, `tsc --listFilesOnly` loads 0 server files this way and 8 through `typeof routes`.
- `AppRouter` is retired. The FE type is `AppApi`, projected with `ApiTypes<AppApi>`.
- Contracts and docs write `import * as z from "zod"` (tree-shaking) and `z.coerce.number<number>()` with zod 4.
- FEs need TypeScript ≥ 5.4.

### Diagnostics
- The negative-control fixture `fe/bad.ts` (C5, merged @ e2eac4b) shows the anti-pattern: importing the type from server routes pulls server files into the FE program.

### Example
[`examples/contract/contracts.ts`](./examples/contract/contracts.ts) (`AppApi`, `ApiTypes`).

### Non-goals
- No FE type inference from controllers or routes.

### Open questions
- None recorded.

### Acceptance
[#85](https://github.com/Laratypes/Laratype/issues/85) (decision) · [#93 Done when](https://github.com/Laratypes/Laratype/issues/93)

---

## createClient

### Status
merged ([#109](https://github.com/Laratypes/Laratype/issues/109)). The result union is planned → [#110](https://github.com/Laratypes/Laratype/issues/110) (CL2).

### Public API
[`packages/client/src/client.ts`](../../packages/client/src/client.ts), [`packages/client/src/types.ts`](../../packages/client/src/types.ts)

```ts
export function createClient<A extends object>(api: A, options?: ClientOptions): ClientOf<A>;
export function createClient<T extends ApiShape<T> = never>(manifest: Manifest, options?: ClientOptions): Client<T>;   // separate-repo FE

export interface ClientOptions {
  baseUrl?: string;                 // the origin; default "" (same origin)
  fetch?: FetchLike;                // default: the global fetch, read at call time
  headers?: HeadersInit;            // sent with every call
}
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ClientOf<A> = Client<ApiTypes<A>>;
export type Client<T> = { readonly [K in keyof T]: T[K] extends EndpointShape ? EndpointCall<T[K]> : Client<T[K]> };
export type EndpointCall<E extends EndpointShape>;   // (input: CallInput<E>) => Promise<ClientResponse<ResponseData<E>>>, input optional when nothing in it is required
export type CallInput<E extends EndpointShape>;      // { params?, query?, body?, headers?, signal? }, see Invariants
export type ResponseData<E extends EndpointShape>;   // the wire type of the response schema; unknown without one
export interface ClientResponse<T> extends Response { json(): Promise<T> }
export type HeaderValues = Record<string, string>;
export interface ManifestRoute { readonly method: string; readonly path: string; readonly errors?: readonly string[] }
export type Manifest = Readonly<Record<string, ManifestRoute>>;   // the generated `manifest` of api.ts
```

```ts
import { appApi } from '$api'                       // .laratype/api/index.gen.ts
const api = createClient(appApi)                    // or createClient(appApi.users), createClient(postsContract)
const res = await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'Hi' } })
const post = await res.json()
```

### Invariants
- **Input:** `createClient` takes the generated `appApi` from `$api` (`.laratype/api/index.gen.ts`), an API node (`appApi.users`), a single contract file, or the generated `manifest` of api.ts for a [separate-repo FE](#separate-repo-fe-generated-manifest). It takes the contract **values** (S2 option a), so the same schemas are available for client-side form validation. Since the [folder tree](./contract.md#contract-folder-tree), the `appApi` mode needs `sauf dev` or `sauf types:generate` to have run. Anything else throws `[@laratype/client] createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest`.
- **Names** follow the folder tree (`api.users.posts.update`). Name-style calls are the primary style. Each client node is frozen, has a null prototype and lists its endpoints and child nodes in definition order.
- **URLs** are the contracts' full paths (`/api/users/:user/posts/:post`), built with [`buildUrl`](./contract.md#url-builder). `baseUrl` is only the origin; it defaults to `""` (same origin), and trailing slashes are stripped. The S2 reference `baseUrl: "/api"` no longer applies. A single contract has no folder prefix, so its endpoint paths are appended to `baseUrl` as they are, and its params are only its own.
- **Call input** (`CallInput<E>`):
  - `params`: every param of the full path, `[x]` folder params included. Values are `string | number` and are encoded with `encodeURIComponent`. A missing required param is a type error and throws before `fetch` is called.
  - `query`: the query schema input, serialized by `buildUrl`.
  - `body`: the body schema input, sent as `JSON.stringify(body)` with `content-type: application/json` unless the call sets one.
  - `headers`: the headers schema input plus any `Record<string, string>`. They override `options.headers`.
  - `signal`: an `AbortSignal`, passed to `fetch`.
  - A part is absent when the endpoint has no such schema, optional when all its keys are optional, and required otherwise. The whole input is optional when nothing in it is required.
- **Result:** a call resolves to the fetch `Response`, non-2xx included, typed `ClientResponse<T>` whose `json()` gives `T`. It rejects only when `fetch` rejects or the URL cannot be built. The CL2 result union (#110) wraps this `Response`: every call goes through one internal `send(method, path, input)`.
- **Wire type** (`ResponseData`): the response schema output after `JSON.stringify` + `JSON.parse` (#107). `Date` → `string` (through `toJSON`). `undefined`, functions and symbols are removed from unions, and a property of only those types is dropped. In arrays they become `null`. `bigint` → `never`, `Map` / `Set` → `{}`. An endpoint without a response schema gives `unknown`. The `Jsonify` helper is internal for now.
- **Runtime:** no Node dependencies. It uses `fetch`, `Headers` and `URLSearchParams` only, and the global `fetch` is read at each call, so a polyfill or a test stub installed later is used.
- The FE program loads 0 server files and 0 hono files: `packages/client/__tests__/fe.test.ts` compiles `fixtures/fe/main.ts` with its own tsconfig (`types: []`, DOM lib, not extending the repo tsconfig) and checks `tsc --listFilesOnly`.

### Diagnostics
- `[@laratype/client] createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest`
- `[@laratype/client] no fetch available: pass options.fetch` (at call time)
- `[@laratype/contract] buildUrl: missing param "<name>" for "<path>"` and `buildUrl: query "<key>" must be a primitive, a Date or an array of them` (from [buildUrl](./contract.md#url-builder))
- Type-level: a missing required param, body or schema header, an unknown param, or a body that doesn't match the schema input (`packages/client/__tests__/client.test-d.ts`).

### Example
[`examples/client/create-client.ts`](./examples/client/create-client.ts)

### Non-goals
- No `Result` union, error narrowing or response parsing by schema here: CL2 [#110](https://github.com/Laratypes/Laratype/issues/110) and CL6 [#159](https://github.com/Laratypes/Laratype/issues/159).
- No dynamic headers, hooks or `credentials`: CL3 [#124](https://github.com/Laratypes/Laratype/issues/124).

### Open questions
- None recorded.

### Acceptance
[#109 Done when](https://github.com/Laratypes/Laratype/issues/109)

---

## Result union

### Status
planned → [#110](https://github.com/Laratypes/Laratype/issues/110) (CL2).

### Design (non-binding)
- Calls resolve to a union quoted from #110: `{ ok: true, status, data } | { ok: false, status, error }`. Here `data` is the response type and `error` is the body of the matching contract error.
- **Error union:** derived from the endpoint's capabilities across all levels, plus the union of its `throws` ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)).
- **Narrowing:** by `ok`, then by `code`. Two errors can share a status (`FORBIDDEN` and an app-defined `EMAIL_NOT_VERIFIED` are both 403), so `status` alone doesn't identify the error.
- There is also a variant for network errors and undeclared statuses. The S2 spike marks an undeclared status with `unexpected: true`. This is unchanged.
- Done when type tests show that narrowing by `code` gives the right body type.

### Open questions
- Resolved: result data is typed `Jsonify<output>` of the response schema (`Date` → `string`) in all three S2 client variants ([#110](https://github.com/Laratypes/Laratype/issues/110), [#107](https://github.com/Laratypes/Laratype/issues/107)). Parsing by schema on the client is CL6 [#159](https://github.com/Laratypes/Laratype/issues/159).

### Acceptance
[#110 Done when](https://github.com/Laratypes/Laratype/issues/110)

---

## Options and hooks

### Status
planned → [#124](https://github.com/Laratypes/Laratype/issues/124) (CL3).

### Design (non-binding)
Per #124: `baseUrl`, dynamic headers (a function, for example for an auth token), `onRequest` / `onResponse` hooks, `credentials`, `AbortSignal` and a custom `fetch`.

### Acceptance
[#124 Done when](https://github.com/Laratypes/Laratype/issues/124)

---

## Path-style calls

### Status
planned → [#140](https://github.com/Laratypes/Laratype/issues/140) (CL4, M3).

### Design (non-binding)
- This is an **additive, type-only** call style: `api.get('/users/:user', { params })` ([#140](https://github.com/Laratypes/Laratype/issues/140)).
- It needs no contract runtime. The API type comes from `import type` (`ApiTypes<AppApi>`) or from generated types.
- The S2 spike measured it at 0.63 KiB gzip.
- The named style stays primary.

### Acceptance
[#140 Done when](https://github.com/Laratypes/Laratype/issues/140)

---

## Separate-repo FE (generated manifest)

### Status
merged ([#133](https://github.com/Laratypes/Laratype/issues/133)). Generation is specified in [typegen.md › sauf types:generate](./typegen.md#sauf-typesgenerate). The client for the manifest, `createClient<AppApi>(manifest)`, is merged ([#109](https://github.com/Laratypes/Laratype/issues/109)).

### Public API
[`packages/client/src/client.ts`](../../packages/client/src/client.ts), see [createClient](#createclient):

```ts
import { createClient } from '@laratype/client'
import { manifest } from './api'                      // generated by `sauf types:generate --api-out`
import type { AppApi } from './api'

const api = createClient<AppApi>(manifest, { baseUrl: 'https://api.example.com' })
await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'Hi' } })
```

### Invariants
- **S2 option (c):** `sauf types:generate` writes one `api.ts` (default `.laratype/api.ts`, `--api-out` to place it in the FE repo). It holds a flattened `AppApi` type alias and a slim runtime manifest keyed by route name (method, full path, the derived and declared error codes). It has no import, no contract lib and no schema lib.
- A separate FE compiles against `api.ts` alone, with `types: []` and the DOM lib; the test loads no other file (`packages/sauf/__tests__/typegen/generate.test.ts`).
- The generated `AppApi` satisfies `ApiShape<A>` and is mutually assignable with `ApiTypes<AppApi>` ([contract.md › API type projection](./contract.md#api-type-projection)).
- **Manifest client:** `createClient<AppApi>(manifest, options)` nests the manifest's route names (`'users.posts.update'` → `api.users.posts.update`) and calls each route's method and full path. The calls are typed `Client<AppApi>`, the same call signatures as `createClient(appApi)`. Without the `AppApi` type argument the client is `never`. A route name without a `.`, or one that is both an endpoint and a node, throws a `[@laratype/client] createClient: ...` TypeError.
- **What the FE program loads:** `api.ts` has no contract lib and no schema lib. The FE program with `@laratype/client` also loads `@laratype/contract`, the client's own dependency, for `buildUrl` and its types. It is browser-pure and has no schema lib. `packages/client/__tests__/fe.test.ts` compiles `fixtures/separate-fe` (`types: []`, DOM lib, own tsconfig) and checks with `tsc --listFilesOnly` that it loads 0 server, hono and schema-lib files and no contract file of the app.

### Design (non-binding)
- Measured by the CL1 fixture (`fixtures/separate-fe`, compiled against `packages/*/src`): 2 generated or own files (`api.ts`, `main.ts`), 3 `@laratype/client` files and 10 `@laratype/contract` files, plus the TypeScript libs. S2's 2 + 4 files predate the shared `buildUrl` in `@laratype/contract`. Bundle size is B8's job ([#132](https://github.com/Laratypes/Laratype/issues/132)).
- The same manifest is an opt-in for monorepo FEs that want schema-free bundles.

### Acceptance
[#133 Done when](https://github.com/Laratypes/Laratype/issues/133) · [#109 Done when](https://github.com/Laratypes/Laratype/issues/109)

---

## Bundle budget

### Status
planned → [#132](https://github.com/Laratypes/Laratype/issues/132) (B8). The rule itself is decided (PM ruling on DOC2, 2026-10-09).

### Design (non-binding)
- **Rule:** the runtime of `@laratype/client` + `@laratype/contract` stays **under 5 kB gzip**. The user-chosen schema library is **excluded**.
- S2's figures are whole-FE-entry costs and must be reported as such:

  | Case | Whole FE entry, min+gzip |
  |---|---|
  | (a) zod 3 | 14.0 KiB |
  | (a) `zod/v4-mini` | 8.3 KiB |
  | (a) zod 4 with `import { z }` | 47.1 KiB |
  | (c) manifest | 0.7 KiB |

- The S2 client runtime itself is about 0.6 KiB gzip.
- B8 also adds a CI check against `node:*` imports, and an FE fixture that type-checks against `dist/`.

### Acceptance
[#132 Done when](https://github.com/Laratypes/Laratype/issues/132)

---

## TanStack Query adapter

### Status
planned → [#141](https://github.com/Laratypes/Laratype/issues/141) (CL5, `@laratype/client-query`).

### Design (non-binding)
Vue and React adapters, generated query keys, and mutations with typed errors. Used in `examples/fullstack-vue` ([#136](https://github.com/Laratypes/Laratype/issues/136)).

### Acceptance
[#141 Done when](https://github.com/Laratypes/Laratype/issues/141)

---

## Dev-mode response validation

### Status
planned → [#159](https://github.com/Laratypes/Laratype/issues/159) (CL6, M4).

### Design (non-binding)
Optionally validate responses against the contract on the client during development, to catch drift between server and contract. This only works with option (a), which ships the schemas.

### Acceptance
[#159 Done when](https://github.com/Laratypes/Laratype/issues/159)
