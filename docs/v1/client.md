---
area: client
packages: ["@laratype/client", "@laratype/client-query"]
issues: [85, 109, 110, 124, 132, 133, 140, 141, 159, 228]
verified-against: Laratype@d70daa7
last-verified: 2026-10-09
---

# Client (`@laratype/client`)

The typed FE client is driven by contracts. On master the package is still the S4 scaffold. Everything below is decided (S2) or planned, and **no client API exists in code yet**. Signatures quoted from the S2 spike are a non-binding reference, not a spec.

Decision record: S2 [#85](https://github.com/Laratypes/Laratype/issues/85), [DECISIONS-S1-S2.md §S2](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s2-85-decision). Spike prototypes: `spikes/v1/s2-api/client/*` on PR #197 @ 4c558fd. The type side the client consumes (`ApiTypes`, `EndpointShape`, `ApiShape`) is in [contract.md › API type projection](./contract.md#api-type-projection).

| Section | Status |
|---|---|
| [Package scaffold](#package-scaffold) | merged @ d70daa7 |
| [FE import rule](#fe-import-rule) | decided (S2 #85); enforced by C5 fixtures, merged @ e2eac4b; generated entry merged ([#228](https://github.com/Laratypes/Laratype/issues/228), [#133](https://github.com/Laratypes/Laratype/issues/133)) |
| [createClient](#createclient) | planned → #109 |
| [Result union](#result-union) | planned → #110 |
| [Options and hooks](#options-and-hooks) | planned → #124 |
| [Path-style calls](#path-style-calls) | planned → #140 |
| [Separate-repo FE (generated manifest)](#separate-repo-fe-generated-manifest) | merged ([#133](https://github.com/Laratypes/Laratype/issues/133)) |
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
export const appApi = defineApi({ 'users': { contract, path, scopes, dirs }, 'users.posts': { ... } })   // see contract.md › defineApi
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
planned → [#109](https://github.com/Laratypes/Laratype/issues/109) (CL1).

### Design (non-binding)
- **Monorepo default (S2 option a):** `createClient(appApi, options)` takes the contract **values**, so the same schemas are available for client-side form validation. `appApi` is the generated one from `$api` (`.laratype/api/index.gen.ts`), or a single contract file. Since the [folder tree](./contract.md#contract-folder-tree), this mode needs `sauf dev` or `sauf types:generate` to have run, so it is no longer build-free.
- **Names** follow the folder tree (`api.users.posts`). URLs come from the contracts, so no base path is needed beyond the domain.
- **Name-style calls are primary:** `api.users.show({ params: { user: 1 } })`.
- **Runtime:** path interpolation with encoding, query serialization, a JSON body, and an injectable `fetch`. No Node dependencies (#109 tasks).
- **Reference shape from the S2 spike** (`s2-api/client/create-client.ts` @ 4c558fd), non-binding:
  ```ts
  createClient(appApi, { baseUrl: "/api", fetch?, headers? })
  // api.users.store({ body, query?, params?, headers?, signal? }) -> Promise<result union>
  ```
  The input argument is optional when nothing in it is required.
- **Shared runtime:** the client and the server `route()` helper are meant to share a pure URL builder in `@laratype/contract` ([#162](https://github.com/Laratypes/Laratype/issues/162)).

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
merged ([#133](https://github.com/Laratypes/Laratype/issues/133)). Generation is specified in [typegen.md › sauf types:generate](./typegen.md#sauf-typesgenerate).

### Invariants
- **S2 option (c):** `sauf types:generate` writes one `api.ts` (default `.laratype/api.ts`, `--api-out` to place it in the FE repo). It holds a flattened `AppApi` type alias and a slim runtime manifest keyed by route name (method, full path, the derived and declared error codes). It has no import, no contract lib and no schema lib.
- A separate FE compiles against `api.ts` alone, with `types: []` and the DOM lib; the test loads no other file (`packages/sauf/__tests__/typegen/generate.test.ts`).
- The generated `AppApi` satisfies `ApiShape<A>` and is mutually assignable with `ApiTypes<AppApi>` ([contract.md › API type projection](./contract.md#api-type-projection)).

### Design (non-binding)
- S2 measured the FE program at 2 generated or own files and 4 client files, about 0.7 KiB gzip in total.
- The same manifest is an opt-in for monorepo FEs that want schema-free bundles. Typing it for the client (`Manifest<AppApi>`) belongs to CL1 [#109](https://github.com/Laratypes/Laratype/issues/109).

### Acceptance
[#133 Done when](https://github.com/Laratypes/Laratype/issues/133)

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
