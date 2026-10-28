---
area: client
packages: ["@laratype/client", "@laratype/client-query"]
issues: [85, 109, 110, 124, 132, 133, 140, 141, 159, 228, 255]
verified-against: Laratype@d70daa7
last-verified: 2026-10-15
---

# Client (`@laratype/client`)

The typed FE client is driven by contracts. `createClient` (CL1) and the result union (CL2) are merged; the other sections are decided (S2) or planned. Signatures quoted from the S2 spike are a non-binding reference, not a spec.

Decision record: S2 [#85](https://github.com/Laratypes/Laratype/issues/85), [DECISIONS-S1-S2.md §S2](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s2-85-decision). Spike prototypes: `spikes/v1/s2-api/client/*` on PR #197 @ 4c558fd. The type side the client consumes (`ApiTypes`, `EndpointShape`, `ApiShape`) is in [contract.md › API type projection](./contract.md#api-type-projection).

| Section | Status |
|---|---|
| [Package scaffold](#package-scaffold) | merged @ d70daa7 |
| [FE import rule](#fe-import-rule) | decided (S2 #85); enforced by C5 fixtures, merged @ e2eac4b; generated entry merged ([#228](https://github.com/Laratypes/Laratype/issues/228), [#133](https://github.com/Laratypes/Laratype/issues/133)) |
| [createClient](#createclient) | merged ([#109](https://github.com/Laratypes/Laratype/issues/109)); `joinPath` separator and same-origin check proposed: PR [#285](https://github.com/Laratypes/Laratype/pull/285) @ a712b84; JSON-safe request input and provided headers proposed: PR [#311](https://github.com/Laratypes/Laratype/pull/311) @ 2449a86; input detection by the `defineApi` root brand proposed: PR [#310](https://github.com/Laratypes/Laratype/pull/310) @ cb9a5fe; `redirect` option and outcomes proposed: PR [#332](https://github.com/Laratypes/Laratype/pull/332) @ 6bbe9eb (CL9 [#315](https://github.com/Laratypes/Laratype/issues/315)) |
| [Result union](#result-union) | merged ([#110](https://github.com/Laratypes/Laratype/issues/110)); redirect outcomes proposed: PR [#332](https://github.com/Laratypes/Laratype/pull/332) @ 6bbe9eb (CL9 [#315](https://github.com/Laratypes/Laratype/issues/315)) |
| [Options and hooks](#options-and-hooks) | proposed: PR [#302](https://github.com/Laratypes/Laratype/pull/302) @ f68de49 ([#124](https://github.com/Laratypes/Laratype/issues/124)); `redirect` option proposed: PR [#332](https://github.com/Laratypes/Laratype/pull/332) @ 6bbe9eb (CL9 [#315](https://github.com/Laratypes/Laratype/issues/315)) |
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
- FEs need TypeScript ≥ 5.4 (the contract types use `NoInfer`). `@laratype/client` declares it as an optional peer (`>=5.4`), so a JS-only or bundler-only install gets no missing-peer warning.
- FEs need `strictNullChecks`, as every consumer of the contract types does ([contract.md](./contract.md)).

### Diagnostics
- The negative-control fixture `fe/bad.ts` (C5, merged @ e2eac4b) shows the anti-pattern: importing the type from server routes pulls server files into the FE program.

### Example
[`examples/contract/proposed/contracts.ts`](./examples/contract/proposed/contracts.ts) (`AppApi`, `ApiTypes`).

### Non-goals
- No FE type inference from controllers or routes.

### Open questions
- None recorded.

### Acceptance
[#85](https://github.com/Laratypes/Laratype/issues/85) (decision) · [#93 Done when](https://github.com/Laratypes/Laratype/issues/93)

---

## createClient

### Status
merged ([#109](https://github.com/Laratypes/Laratype/issues/109)). Calls resolve to the [result union](#result-union), merged ([#110](https://github.com/Laratypes/Laratype/issues/110)). The `joinPath` separator and the same-origin route path check (C9 [#257](https://github.com/Laratypes/Laratype/issues/257)) are proposed: PR [#285](https://github.com/Laratypes/Laratype/pull/285) @ a712b84. The JSON-safe request input and the headers `options.headers` provides (CL7 [#255](https://github.com/Laratypes/Laratype/issues/255)) are proposed: PR [#311](https://github.com/Laratypes/Laratype/pull/311) @ 2449a86. The `redirect` option and the redirect outcomes of a call (CL9 [#315](https://github.com/Laratypes/Laratype/issues/315)) are proposed: PR [#332](https://github.com/Laratypes/Laratype/pull/332) @ 6bbe9eb.

### Public API
[`packages/client/src/client.ts`](../../packages/client/src/client.ts), [`packages/client/src/types.ts`](../../packages/client/src/types.ts)

```ts
// Hd: the type of options.headers (inferred; the second manifest overload takes it as a type argument)
export function createClient<T extends ApiShape<T> = never>(manifest: Manifest, options?: ClientOptions): Client<T>;   // separate-repo FE
export function createClient<T extends ApiShape<T>, Hd extends HeadersInit>(manifest: Manifest, options: ClientOptions<Hd> & { headers: Hd & HeaderValues }): Client<T, ProvidedHeaders<Hd>>;
export function createClient<C extends AnyContract, const Hd extends HeadersInit = HeadersInit>(contract: C, options?: ClientOptions<Hd>): ClientOf<C, ProvidedHeaders<Hd>>;
export function createClient<N extends ApiNodeShape, const Hd extends HeadersInit = HeadersInit>(node: N, options?: ClientOptions<Hd>): ClientOf<N, ProvidedHeaders<Hd>>;
export function createClient<A extends ApiRootShape, const Hd extends HeadersInit = HeadersInit>(api: A, options?: ClientOptions<Hd>): ClientOf<A, ProvidedHeaders<Hd>>;   // the appApi
export type ApiNodeShape = { readonly [API_NODE]: ApiNodeInfo };
export type ApiRootShape = { readonly [API_ROOT]: true };   // the root brand that defineApi sets

export interface ClientOptions<Hd extends HeadersInit = HeadersInit> {
  baseUrl?: string;                 // an absolute URL (https://…) or a path starting with /; default "" (same origin)
  fetch?: FetchLike;                // default: the global fetch
  headers?: Hd | (() => HeadersInit | Promise<HeadersInit>);   // sent with every call; a function provides no header to the types
  credentials?: RequestCredentials; redirect?: RequestRedirect; onRequest?: …; onResponse?: …      // see Options and hooks (CL3, CL9)
  // every option is read from this object at each call
}
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ClientOf<A, P = {}> = Client<ApiTypes<A>, P>;
export type Client<T, P = {}> = { readonly [K in keyof T]: T[K] extends EndpointShape ? EndpointCall<T[K], P> : Client<T[K], P> };
export type EndpointCall<E extends EndpointShape, P = {}>;   // (input: CallInput<E, P>) => Promise<ClientResult<E>>, input optional when nothing in it is required
export type CallInput<E extends EndpointShape, P = {}>;      // { params?, query?, body?, headers?, signal? }, see Invariants; P: the headers options.headers provides
export type ProvidedHeaders<Hd>;   // the headers an options.headers object always sends, with their values; {} for Headers, pairs or Record<string, string>
export type ResponseData<E extends EndpointShape>;   // the wire type of the response schema; undefined without one or for a declared 204 or 205
export type HeaderValues = Record<string, string>;
export interface ManifestRoute { readonly method: string; readonly path: string; readonly errors?: readonly string[] }
export type Manifest = Readonly<Record<string, ManifestRoute>>;   // the generated `manifest` of api.ts
```

```ts
import { appApi } from '$api'                       // .laratype/api/index.gen.ts
const api = createClient(appApi)                    // or createClient(appApi.users), createClient(postsContract)
const result = await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'Hi' } })
if (result.ok) result.data.title                     // see Result union
```

### Invariants
- **Input:** `createClient` takes exactly one of four inputs: the generated `appApi` from `$api` (`.laratype/api/index.gen.ts`), one API node (`appApi.users`), one contract file, or the generated `manifest` of api.ts for a [separate-repo FE](#separate-repo-fe-generated-manifest). The inputs are told apart by their brands, with `isApiRoot`, `isApiNode`, `isContract` and `isEndpoint` from `@laratype/contract`, never by shape ([contract.md › defineApi and route names](./contract.md#defineapi-and-route-names)): only the root that `defineApi` returns is the `appApi`, so a hand-made object such as `{ posts: appApi.users.posts }`, `{ users: appApi.users }` or `{ users: usersContract }` is rejected, at compile time and at runtime. A spread `{ ...appApi }` drops the non-enumerable brand, so it throws at runtime, but compiles: TypeScript keeps the symbol key in its type. The overloads type the same four inputs, so anything else, a single endpoint included, fails to compile. It takes the contract **values** (S2 option a), so the same schemas are available for client-side form validation. Since the [folder tree](./contract.md#contract-folder-tree), the `appApi` mode needs `sauf dev` or `sauf types:generate` to have run. A single endpoint throws `[@laratype/client] createClient: got a single endpoint; pass its contract, an API node or the appApi`, and anything else throws `[@laratype/client] createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest`. Endpoints are recognized by their `Symbol.for` brand ([contract.md › Endpoint builder](./contract.md#endpoint-builder)), so a contract from another bundle or package copy works.
- **Names** follow the folder tree (`api.users.posts.update`). Name-style calls are the primary style. Each client node is frozen, has a null prototype and lists its endpoints and child nodes in definition order.
- **One source of routes:** every input is turned into flat routes (name, method, full path) and nested by route name. The `appApi`, an API node and a contract go through `apiPaths()` ([contract.md › defineApi and route names](./contract.md#defineapi-and-route-names)), the same walker behind the router's `apiRoutes()`, so names and paths match the router's. It resolves no capabilities: a route's declared errors are resolved lazily, on its first non-2xx answer, and a contract whose `.authorize()` gets `auth` from a folder scope still builds on its own. An API node's names are relative to it. The manifest gives its routes directly.
- **URLs** are the contracts' full paths (`/api/users/:user/posts/:post`), built with [`buildUrl`](./contract.md#url-builder). `baseUrl` is only the origin; it defaults to `""` (same origin) and trailing slashes are stripped. It must be an absolute URL with `://` or a path starting with `/`: anything else (`localhost:3000/api`, `api`, a protocol-relative `//host/api`) throws `[@laratype/client] createClient: baseUrl "<baseUrl>" must be an absolute URL (https://…) or a path starting with /`, and so does a query, a hash, a backslash or any whitespace or control character. `baseUrl` is parsed once with `URL` (against a sentinel origin, so a path stays a path); the path is normalized (`/a/./b/../c` is `/a/c`) and the origin is the parsed one. An invalid URL (a bad port), credentials (`https://user:pass@…`) or a scheme other than `http`/`https` throws, at `createClient` and at a call if `options.baseUrl` is changed later (http(s) URL parsing turns `/\evil.com` into another host, and strips the tab in `/\t/evil.com`, which becomes `//evil.com`). The S2 reference `baseUrl: "/api"` no longer applies. A single contract has no folder prefix, so its endpoint paths are appended to `baseUrl`, and its params are only its own. `buildUrl` fills the route path alone, then the result is joined to `baseUrl`'s path with the server's `joinPath`, so `baseUrl` is never parsed as route syntax (a `:tenant` in it stays as it is). `joinPath` always puts a `/` between the two, so a route path that doesn't start with `/` (a hand-edited manifest, a forged endpoint) can't extend the host: `':tenant/x'` with `{ tenant: '.evil.com' }` under `https://api.example.com` is `https://api.example.com/.evil.com/x`, not `https://api.example.com.evil.com/x` (#257). [`buildUrl`](./contract.md#url-builder) already refuses a route path that URL parsing reads as another host (`//evil.com`, `/\evil.com`, `/<tab>/evil.com`). Under a same-origin `baseUrl` (no origin), the joined path is checked the same way (parsed against two sentinel origins), which catches a route path that only becomes one once `/` is put before it (`<tab>/evil.com`), and the call rejects with `[@laratype/client] route path "<path>" would leave the page's origin: "<joined path>"`. a route path of `/` is `baseUrl` itself (`https://host/api/users`, not `.../users/`, which strict routing answers with 404).
- **Call input** (`CallInput<E>`):
  - `params`: every param of the full path, `[x]` folder params included. Values are `string | number` and are encoded with `encodeURIComponent`. A missing required param is a type error and throws before `fetch` is called.
  - `query`: the query schema input, serialized by `buildUrl`. A `Date` value (alone or in an array) is typed `Date | string`, since `buildUrl` sends it as its ISO string. Every query value reaches the server as a string (a repeated key as an array), and converting it is the schema's job (H3, PR [#301](https://github.com/Laratypes/Laratype/pull/301)), so a number, boolean or date field needs a coercing schema (`z.coerce.number()`, `z.coerce.date()`).
  - `body`: the [JSON-safe input](#json-safe-request-input) of the body schema, sent as `JSON.stringify(body)` with `content-type: application/json` unless a `content-type` is set: the call's own `headers` win, then `options.headers`, then the `application/json` default.
  - `headers`: the headers schema input plus any `Record<string, string>`. They override `options.headers`. A schema header that `options.headers` always sends, with a value the schema accepts, is optional in every call (names compare case-insensitively): `createClient(appApi, { headers: { 'x-api-key': key } })` makes a required `x-api-key` optional. `createClient` infers the type of `options.headers` as `const` (a literal value such as `'2'` keeps its literal type, with no `as const`), and `ProvidedHeaders` keeps its literal keys that are required in every member of a union, with their value types: an optional key (also under `exactOptionalPropertyTypes`), a key in only some members, `string` or a pattern key (`` `x-${string}` ``) provides nothing, and so do a `Headers` and an array of pairs, so required schema headers stay required. A provided value the schema rejects (`'1'` for `z.literal('2')`, or any `string` for it) leaves the header required too, and so does a `headers` function ([Options and hooks](#options-and-hooks)): its headers are known only when it runs. The manifest client can't infer the headers type next to the explicit `AppApi`, so it is the second type argument of a second overload, where `options.headers` is required, must send those headers and may send others: `createClient<AppApi, { 'x-api-key': string }>(manifest, { headers: { 'x-api-key': key } })`. The type trusts `options.headers` as given at `createClient`; options stay live, so removing such a header later is not seen by the type.
  - `signal`: an `AbortSignal`, passed to `fetch`.
  - A part is absent when the endpoint has no such schema, optional when all its keys are optional, and required otherwise. The whole input is optional when nothing in it is required.
- **Result:** a call resolves to the [result union](#result-union) and never rejects for an HTTP or network outcome. It never throws either: a configuration or programming error rejects, whether the URL cannot be built (a missing required param), the body cannot be serialized, or there is no `fetch`. A redirect is an HTTP outcome, not a rejection: under the default `redirect: "manual"` ([Options and hooks](#options-and-hooks)) a real 3xx (Node, Bun) is the unexpected result with its status and `response` set, and a browser's `opaqueredirect` is the status-0 unexpected result with `response` set.
- **Global `fetch` vs injected `fetch`:** both get `(url, init)`, and `fetch` resolves a relative URL itself (against the document's base URL in a browser). The client checks only what would otherwise look like a network failure: a GET with a body rejects with `[@laratype/client] a GET request cannot have a body: "<path>"`, and with the global `fetch` a relative URL outside a browser (no `document` or `location`, as in Node SSR or Deno without `--location`, or a page base that doesn't resolve the URL to http(s), such as `about:blank`, `about:srcdoc`, the jsdom default, `blob:` or `data:`) rejects; set `baseUrl` to an absolute URL, or pass `fetch`. An injected `fetch` is not guarded, since it may resolve relative URLs itself. A synchronous throw from `fetch`, global or injected, rejects the call; only a rejected promise is the status-0 result.
- <a id="json-safe-request-input"></a>**JSON-safe request input** (#255): the server validates the parsed JSON body ([validation.md](./validation.md); H3, PR [#301](https://github.com/Laratypes/Laratype/pull/301), reads a JSON body by its media type), so the call's `body` is typed with what `JSON.stringify` carries, not the raw schema input. A value with `toJSON` is accepted as itself or as its JSON form (`Date` → `Date | string`; both send the same ISO string), unless that form is one JSON can't carry (`toJSON(): bigint`): then the value is `never` too, since `JSON.stringify` throws. A value JSON can't carry is `never`, so passing it is a type error: `bigint` (`JSON.stringify` throws), `Map` / `Set` (sent as `{}`), functions and symbols; a body that is one of them as a whole stays required, as `never`. An `undefined` array item is removed from the item type, since it is sent as `null`. Everything else is the schema input unchanged, optional keys included. The wire carries a string, so a body or query field whose handler wants a `Date` needs a schema that accepts the ISO string: `z.coerce.date()` (zod 3) or `z.coerce.date<Date>()` (zod 4, as `z.coerce.number<number>()` in [contract.md › Validation adapter](./contract.md#validation-adapter)); a handler that wants the ISO string itself uses `z.string().datetime()` (zod 3) or `z.iso.datetime()` (zod 4). A `z.date()` body field fails validation (422) for any request, since no JSON value is a `Date`; the client type can't tell it from `z.coerce.date()` (both have the input `Date` in zod 3). `packages/client/__tests__/wire-input.test.ts` sends a `Date` body field and a `Date` query value to a server that validates them as validation.md specifies, and gets them back without a 422.
- **Options are live:** every option (`baseUrl`, `headers`, `fetch`, and those of [Options and hooks](#options-and-hooks)) is read from the options object when each call starts, so changing one later (a refreshed token) applies to the next call.
- **Wire type** (`ResponseData`, and the error bodies): the schema output after `JSON.stringify` + `JSON.parse` (#107). `Date` → `string` (through `toJSON`). `undefined`, functions and symbols are removed from unions, and a property of only those types is dropped. A property that may be `undefined` (`x?: X` or `x: X | undefined`) is optional, since `JSON.stringify` drops it. In arrays they become `null`. `bigint` → `never`, `Map` / `Set` → `{}`. An endpoint without a response schema, or with a declared 204 or 205, gives `undefined`. `Jsonify` is exported by `@laratype/contract` ([API type projection](./contract.md#api-type-projection)).
- **Runtime:** no Node dependencies. It uses `fetch`, `Headers` and `URLSearchParams` only, and the global `fetch` is read at each call, so a polyfill or a test stub installed later is used.
- The FE program loads 0 server files and 0 hono files: `packages/client/__tests__/fe.test.ts` compiles `fixtures/fe/main.ts` with its own tsconfig (`types: []`, DOM lib, not extending the repo tsconfig) and checks the program of one `tsc --listFiles` run.

### Diagnostics
- `[@laratype/client] createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest`
- `[@laratype/client] createClient: got a single endpoint; pass its contract, an API node or the appApi`
- `[@laratype/client] createClient: baseUrl "<baseUrl>" must not have a query or a hash` (at `createClient`; a call rejects with it if `options.baseUrl` is changed later)
- `[@laratype/client] no fetch available: pass options.fetch` (the call rejects)
- `[@laratype/client] route path "<path>" would leave the page's origin: "<joined path>"` (the call rejects: a same-origin `baseUrl` and a route path that URL parsing reads as another host)
- `[@laratype/contract] buildUrl: missing param "<name>" for "<path>"` and `buildUrl: query "<key>" must be a string, number, boolean, bigint or Date, or an array of them` (from [buildUrl](./contract.md#url-builder))
- Type-level: a missing required param, body or schema header (unless `options.headers` names it), an unknown param, a body that doesn't match the schema input, or a body value JSON can't carry (`bigint`, `Map`, `Set`, a function) (`packages/client/__tests__/client.test-d.ts`).

### Example
[`examples/client/create-client.ts`](./examples/client/create-client.ts)

### Non-goals
- No response parsing by schema: CL6 [#159](https://github.com/Laratypes/Laratype/issues/159).

### Open questions
- None recorded.

### Acceptance
[#109 Done when](https://github.com/Laratypes/Laratype/issues/109) · [#255 Done when](https://github.com/Laratypes/Laratype/issues/255)

---

## Result union

### Status
merged ([#110](https://github.com/Laratypes/Laratype/issues/110)). The redirect outcomes are proposed: PR [#332](https://github.com/Laratypes/Laratype/pull/332) @ 6bbe9eb (CL9 [#315](https://github.com/Laratypes/Laratype/issues/315)).

### Public API
[`packages/client/src/types.ts`](../../packages/client/src/types.ts), [`packages/client/src/client.ts`](../../packages/client/src/client.ts)

```ts
export type ClientResult<E extends EndpointShape> = ClientSuccess<E> | ClientFailure<E> | UnexpectedResult;
export interface ClientSuccess<E extends EndpointShape> {
  ok: true; status: E["status"]; data: ResponseData<E>; response: Response; code?: undefined; unexpected?: undefined;
}
export type ClientFailure<E extends EndpointShape>;   // per error of E["errors"]:
//   { ok: false; status: St; code: Code; error: Jsonify<Body>; response: Response; unexpected?: undefined }
export interface UnexpectedResult {
  ok: false; unexpected: true; status: number; error: unknown; response: Response | undefined; text?: string; code?: undefined;
}
```

```ts
const result = await api.users.store({ body })
if (result.ok) return result.data                     // 201, Jsonify<UserDto>
switch (result.code) {
  case 'EMAIL_TAKEN':      result.error.email; break   // 409, the body of EmailTaken
  case 'VALIDATION_ERROR': result.error.errors; break  // 422, { message, errors }
  case undefined:          result.unexpected; break    // true: network, undeclared status or code, non-JSON
}
```

### Invariants
- **Wire format of an error:** the JSON body is the error's body plus its code, flat: `{ "code": "EMAIL_TAKEN", "message": "...", "email": "..." }`. It holds for domain errors and the framework catalog errors alike (`{ "code": "VALIDATION_ERROR", "message": "...", "errors": {...} }`). A body is a plain object without its own `code` key ([contract.md › Domain errors](./contract.md#domain-errors)). The server side is H5 [#108](https://github.com/Laratypes/Laratype/issues/108) ([http.md › Exceptions](./http.md#exceptions)). The unknown-error 500 body `{ message: "Server Error" }` has no `code`, so the client sees it as unexpected.
- **Success:** the endpoint's declared status, which `status` is typed with. Any other 2xx (200 for a declared 201) is unexpected.
- **Data:** `undefined`, in the type and at runtime, for an endpoint with no response schema or a declared body-less status (204, 205, or another set with `.status(n)`); the body is then not read. With a response schema, `data` is the parsed JSON body, typed with the [wire type](#createclient) of the schema, and an empty 2xx body is unexpected, since the server broke the contract.
- **Manifest (known gap):** the manifest carries neither the success status, nor whether there is a response schema, nor the error statuses, so `createClient<AppApi>(manifest)` accepts any 2xx, parses a body if there is one, and matches errors by code only. Its types still claim the declared statuses and schemas from `AppApi`, which the runtime cannot check. Emitting them in the manifest is planned → [#259](https://github.com/Laratypes/Laratype/issues/259).
- **Declared error:** a non-2xx JSON object body whose `code` is one of the endpoint's declared codes, and whose status is one of the statuses that code is declared with, when known (a code may be declared twice: a `.throws(defineError(410, 'NOT_FOUND'))` next to the derived 404 classifies both). `code` is that code and `error` is the body without `code`. The declared codes are the [derived errors](./contract.md#capabilities-and-derived-errors) of the endpoint's capabilities across all levels, plus the union of its `throws`. They come from `routeErrors` on each `apiPaths()` route ([contract.md › defineApi and route names](./contract.md#defineapi-and-route-names)) for an `appApi`, an API node or a contract, and from the manifest's `errors` for `createClient<AppApi>(manifest)` (codes only, so any status). A contract alone has no scope chain, so its declared errors are those of its own options and endpoints, as `ClientOf` types them. It cannot know its folder's errors (a scope's `auth` 401, a folder param's 404); use an `appApi` node (`createClient(appApi.users.posts)`) to get the full error set.
- **Narrowing:** by `ok`, then by `code`. Two errors can share a status (`FORBIDDEN` and an app-defined `ACCOUNT_LOCKED` are both 403), so `status` alone doesn't identify the error. `code` is `undefined` on the unexpected variant, so `switch (result.code)` covers it with `case undefined`.
- **Unexpected** (`unexpected: true`), always with `response` except before the headers arrive:
  - a network failure or an abort before the headers arrive: `status: 0`, `response: undefined`, `error` is the thrown error; the `redirect: "error"` opt-in turns a redirect into the same result ([Options and hooks](#options-and-hooks));
  - a redirect under the default `redirect: "manual"` ([Options and hooks](#options-and-hooks)): the real 3xx in Node and Bun, so its HTTP status with `response` set (a 3xx is not a declared 2xx, so it is unexpected like any other undeclared status); in a browser an `opaqueredirect` response, `status: 0` with `response` set (`response.type` is `opaqueredirect`, or `opaque` for `mode: "no-cors"` set by `onRequest` or an injected `fetch`), so `response` tells it apart from a network failure;
  - an abort or a network error while the body is read, after the headers arrived: the HTTP `status`, `response`, and `error` is the read error;
  - a 2xx other than the declared status, or an empty body where a response schema is declared;
  - a status or code the endpoint doesn't declare, or a JSON body without `code` (`error` is the parsed body);
  - a body that isn't JSON, on any status: `error` is the `SyntaxError`, and `text` holds the raw body (an HTML 502 from a proxy), since the body is consumed.
- **`response`** is the fetch `Response` on every variant except a failure before the headers. The client reads its body once, so the body is consumed (`bodyUsed`); status and headers such as `Retry-After` stay usable. A body-less success (`data: undefined`) doesn't read the body; unless it is a 204 or 205, the client cancels it, so an unread body doesn't hold a connection open (undici).
- A call never rejects for an HTTP or network outcome; see [createClient](#createclient) › Result.

### Diagnostics
Type-level (`packages/client/__tests__/client.test-d.ts`): narrowing by `ok` then `code` gives each error's status and body, including two errors with the same status. Reading `data` before narrowing by `ok`, or a field of one error's body (`result.error.email`) before narrowing by `code`, is a type error.

### Example
[`examples/client/create-client.ts`](./examples/client/create-client.ts) (`register`)

### Non-goals
- No retries, and no throwing variant (`unwrap`).
- No parsing by schema: CL6 [#159](https://github.com/Laratypes/Laratype/issues/159).

### Open questions
- Resolved: result data is typed `Jsonify<output>` of the response schema (`Date` → `string`) in all three S2 client variants ([#110](https://github.com/Laratypes/Laratype/issues/110), [#107](https://github.com/Laratypes/Laratype/issues/107)).

### Acceptance
[#110 Done when](https://github.com/Laratypes/Laratype/issues/110)

---

## Options and hooks

### Status
proposed: PR [#302](https://github.com/Laratypes/Laratype/pull/302) @ f68de49 ([#124](https://github.com/Laratypes/Laratype/issues/124), CL3), with the `redirect` option proposed: PR [#332](https://github.com/Laratypes/Laratype/pull/332) @ 6bbe9eb (CL9 [#315](https://github.com/Laratypes/Laratype/issues/315)). Extends the `ClientOptions` of [createClient](#createclient).

### Public API
[`packages/client/src/types.ts` @ 6bbe9eb](https://github.com/Laratypes/Laratype/blob/6bbe9ebdb99a8b32ea7c4211bfec2878f2e82b3a/packages/client/src/types.ts)

```ts
export interface ClientOptions {
  baseUrl?: string;                                              // as in createClient
  fetch?: FetchLike;                                             // as in createClient
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
  redirect?: RequestRedirect;                                    // CL9 #315
  onRequest?: (request: ClientRequest) => void | Promise<void>;
  onResponse?: (response: Response, request: ClientRequest) => void | Promise<void>;
}
export interface ClientRequest {
  readonly url: string;
  readonly init: RequestInit & { headers: Headers };
}
```

### Invariants
- **Live options:** every option is read from the options object when each call starts, as `baseUrl`, `headers` and `fetch` already are, so one call never mixes old and new options.
- **Dynamic headers:** a `headers` function is called, and awaited, at each call (a fresh auth token). Its headers are the defaults: the call's own `headers` override them, then `content-type: application/json` is added for a body when neither sets one ([createClient](#createclient) › Call input).
- **`credentials`:** set on every call's `RequestInit` when given; absent otherwise, so `fetch` keeps its default (`same-origin`).
- **Redirects:** the client sets `init.redirect` on every call from `options.redirect`, default `"manual"`, so a Fetch-conforming `fetch` doesn't follow a redirect. On Node and Bun the call gets the real 3xx and resolves as the [unexpected result](#result-union) with that status and `response` set. In a browser it gets an `opaqueredirect` response: the status-0 result, also with `response` set ([Result union](#result-union)), so a redirect is told apart from a network failure. `"follow"` and `"error"` are opt-ins. `"follow"` follows redirects, and on a cross-origin redirect it drops `authorization` but keeps other custom headers, and with `credentials: "include"` it may send the cookies the new origin has, subject to cookie policy (scope, `SameSite`). `"error"` makes `fetch` reject, so the call resolves as the status-0 unexpected result without `response`; Cloudflare Workers (`workerd`) doesn't support it, and rejects `fetch` when it is set. Some fetches ignore the mode: an injected `fetch`, and React Native's global `fetch` (XHR-based), which always follows. A per-call `init.redirect` set by `onRequest` still wins over `options.redirect`. This is a **breaking default** for v1 client users: before it, the client set no `redirect`, so `fetch` followed redirects; an app opts back in with `createClient(appApi, { redirect: "follow" })`.
- **`AbortSignal`:** per call, `signal` in the call input ([createClient](#createclient) › Call input). There is no client-wide signal; `onRequest` can set `request.init.signal`.
- **Custom `fetch`:** `options.fetch` ([createClient](#createclient) › Global `fetch` vs injected `fetch`).
- **Order of a call:** build the URL and the JSON body → the checks that reject before sending (a missing param, a GET with a body, a body JSON cannot hold, no `fetch`, a relative URL outside a browser) → the `headers` function → `onRequest` → `fetch(url, init)` → `onResponse` → the [result union](#result-union). So neither the `headers` function nor `onRequest` is called for a request that is never sent.
- **`onRequest`** gets a frozen `{ url, init }`: the URL as built and the `init` that `fetch` then gets, its `headers` already merged into a `Headers`. It may change `init` (add a signature header, set a `signal`); the URL and the `init` object itself can't be replaced. A body it puts on a GET or HEAD (or on a request whose `method` it removes: `fetch` then sends a GET) rejects the call with `a <METHOD> request cannot have a body`.
- **Abort before `fetch`:** a call whose `signal` is aborted before `fetch` resolves as the status-0 unexpected result, with the signal's reason. The signal is checked before the `headers` function, before `onRequest` and before `fetch`, so no step runs once it is aborted; aborting does not interrupt a pending `headers` function or hook.
- **`onResponse`** gets every response `fetch` resolves with, whatever its status, and the same request, before the client reads the body; it must read a `response.clone()`, since the client reads the body itself, and one that reads or locks the body of `response` rejects the call. A clone it makes is its own to read or cancel. It is not called when `fetch` rejects (the status-0 result).
- **Failures:** a `headers` function or a hook that throws or rejects rejects the call, like the other configuration errors ([createClient](#createclient) › Result); it is never turned into a result. A failing `headers` function or `onRequest` means `fetch` is not called; a failing `onResponse` cancels the unread body, so it doesn't hold a connection open.
- **Runtime:** browser-pure, as the rest of the client: no Node API.

### Diagnostics
- The error a `headers` function or a hook throws rejects the call as it is.
- `[@laratype/client] a <METHOD> request cannot have a body: "<path>"` (the call rejects: `onRequest` put a body on a GET or HEAD)
- `[@laratype/client] onResponse read the response body: read a response.clone() instead` (the call rejects)
- Type-level (`packages/client/__tests__/client.test-d.ts`): a `headers` function that doesn't return `HeadersInit`, a `credentials` that isn't a `RequestCredentials`, a `redirect` that isn't a `RequestRedirect`, and assigning `request.url` are type errors.

### Example
[`examples/client/proposed/options-and-hooks.ts`](./examples/client/proposed/options-and-hooks.ts)

### Non-goals
- No retries, no replacing the response from `onResponse` (wrap `fetch` for that), and no hook on a network failure.
- No client-wide `AbortSignal` or timeout.

### Open questions
- None recorded.

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
const result = await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'Hi' } })
```

### Invariants
- **S2 option (c):** `sauf types:generate` writes one `api.ts` (default `.laratype/api.ts`, `--api-out` to place it in the FE repo). It holds a flattened `AppApi` type alias and a slim runtime manifest keyed by route name (method, full path, the derived and declared error codes). It has no import, no contract lib and no schema lib.
- A separate FE compiles against `api.ts` alone, with `types: []` and the DOM lib; the test loads no other file (`packages/sauf/__tests__/typegen/generate.test.ts`).
- The generated `AppApi` satisfies `ApiShape<A>` and is mutually assignable with `ApiTypes<AppApi>` ([contract.md › API type projection](./contract.md#api-type-projection)).
- **Manifest client:** `createClient<AppApi>(manifest, options)` nests the manifest's route names (`'users.posts.update'` → `api.users.posts.update`) and calls each route's method and full path. The calls are typed `Client<AppApi>`, the same call signatures and [result union](#result-union) as `createClient(appApi)`. The manifest's `errors` (codes only) decide which error codes are declared. Without the `AppApi` type argument the client is `never`. A route name without a `.`, or one that is both an endpoint and a node, throws a `[@laratype/client] createClient: ...` TypeError.
- **What the FE program loads:** `api.ts` has no contract lib and no schema lib. The FE program with `@laratype/client` also loads `@laratype/contract`, the client's own dependency, for `buildUrl` and its types. It is browser-pure and has no schema lib. `packages/client/__tests__/fe.test.ts` compiles `fixtures/separate-fe` (`types: []`, DOM lib, own tsconfig) and checks with `tsc --listFiles` that it loads 0 server, hono and schema-lib files and no contract file of the app.

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
