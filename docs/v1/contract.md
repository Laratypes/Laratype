---
area: contract
packages: ["@laratype/contract"]
issues: [89, 90, 91, 92, 93, 94, 162, 228]
verified-against: Laratype@d70daa7 (+ PR #205 @ 8791758, PR #204 @ ded1bfc)
last-verified: 2026-10-09
---

# Contract (`@laratype/contract`)

A contract is the single source of truth for one group of endpoints. It is a runtime value, so the router, the client, typegen and OpenAPI all read the same object. The package is browser-safe and has no runtime dependencies. Schemas are any [Standard Schema](https://standardschema.dev) implementation.

Canonical API: the exports of `packages/contract/src/index.ts`. Executable spec: `packages/contract/__tests__/` (runtime tests plus `types/*.types.ts`, compiled by `typecheck.test.ts`).

| Section | Status |
|---|---|
| [Standard Schema types](#standard-schema-types) | merged @ d70daa7; `StandardIssue` proposed: PR #205 @ 8791758 |
| [Path params](#path-params) | merged @ d70daa7 |
| [Endpoint builder](#endpoint-builder) | merged @ d70daa7; `.errors()` available; superseded by planned → #228 |
| [Error catalog](#error-catalog) | merged @ d70daa7; available; superseded by planned → #228 |
| [Validation adapter](#validation-adapter) | proposed: PR #205 @ 8791758 |
| [defineContract](#definecontract) | proposed: PR #204 @ ded1bfc; superseded by planned → #228 |
| [defineApi and route names](#defineapi-and-route-names) | proposed: PR #204 @ ded1bfc; superseded by planned → #133, #228 |
| [API type projection](#api-type-projection) | proposed: PR #204 @ ded1bfc |
| [Contract folder tree](#contract-folder-tree) | planned → #228, #133, #142, #104 |
| [Folder scopes](#folder-scopes) | planned → #228, #104 |
| [Capabilities and derived errors](#capabilities-and-derived-errors) | planned → #228 |
| [Domain errors](#domain-errors) | planned → #228, #108 |
| [URL builder](#url-builder) | planned → #162 |
| [Type test suite in CI](#type-test-suite-in-ci) | planned → #94 |

Package-level invariants:
- `src/` compiles with `lib: [ES2022, DOM]` and `types: []`, so it never imports `node:*` or server packages. Enforced by `typecheck.test.ts` ("src is browser-safe").
- `sideEffects: false`. Every export is a pure value or a type.
- Consumers need TypeScript ≥ 5.4 (`NoInfer` in emitted `.d.ts`). This is declared as an optional peer dependency.
- `PACKAGE_NAME = '@laratype/contract'` (merged @ d70daa7) is exported for smoke tests.

---

## Standard Schema types

### Status
merged @ d70daa7. `StandardIssue` (an extracted named type, with no shape change) is proposed: PR #205 @ 8791758.

### Public API
[`standard-schema.ts` @ d70daa7](https://github.com/Laratypes/Laratype/blob/d70daa77bfceeb99bba44938431535908784a9ce/packages/contract/src/standard-schema.ts#L1-L17) · [`StandardIssue` @ 8791758](https://github.com/Laratypes/Laratype/blob/879175840605c45ee703eaf2a3005ed85337b5e5/packages/contract/src/standard-schema.ts#L12-L15)

```ts
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}
export interface StandardIssue {                         // PR #205
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}
export type StandardResult<O> =
  | { readonly value: O; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> };    // inline object type on master
export type InferIn<S>  = S extends StandardSchemaV1 ? NonNullable<S["~standard"]["types"]>["input"]  : undefined;
export type InferOut<S> = S extends StandardSchemaV1 ? NonNullable<S["~standard"]["types"]>["output"] : undefined;
```

### Invariants
- These are types only, a minimal copy of the Standard Schema v1 spec. The package never imports a schema library at runtime.
- `InferIn<undefined>` and `InferOut<undefined>` are `undefined`, so an empty endpoint slot projects to `undefined`.
- Inputs (query, body, headers) are typed with the schema **input**; the response is typed with the schema **output** (see [API type projection](#api-type-projection)).

### Diagnostics
- Passing a non-Standard-Schema value to a builder slot fails to type-check (`@ts-expect-error schemas must implement Standard Schema` in `types/endpoint.types.ts`).

### Example
See [`examples/contract/endpoint.ts`](./examples/contract/endpoint.ts) (`InferIn` / `InferOut`).

### Non-goals
- No schema-library adapters. zod 3.25+, valibot and arktype implement the spec natively.

### Open questions
- Resolved: the frontend type of a response is `Jsonify<output>`, a browser-safe utility type in `@laratype/contract`, so a `Date` output is typed `string` on the client ([#107](https://github.com/Laratypes/Laratype/issues/107), [#110](https://github.com/Laratypes/Laratype/issues/110)). Parsing the response by schema on the client is CL6 [#159](https://github.com/Laratypes/Laratype/issues/159).

### Acceptance
[#89 Done when](https://github.com/Laratypes/Laratype/issues/89) · [#91 Done when](https://github.com/Laratypes/Laratype/issues/91)

---

## Path params

### Status
merged @ d70daa7 (C2 [#90](https://github.com/Laratypes/Laratype/issues/90)).

### Public API
[`path.ts` @ d70daa7](https://github.com/Laratypes/Laratype/blob/d70daa77bfceeb99bba44938431535908784a9ce/packages/contract/src/path.ts#L1-L33)

```ts
// abridged: the Split<P> parser behind PathParams is internal, see the permalink
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
export type PathParams<P extends string> = Prettify<Split<P>>;                // e.g. "/users/:user/posts/:post?" -> { user: string; post?: string }
export type PathParamKeys<P extends string> = keyof PathParams<P> & string;
```

### Invariants
- The syntax follows Hono routes:
  - `:name` is a required `string`;
  - `:name?` is an optional `string`;
  - `:name{regex}` gives the key `name`, and the pattern never leaks into the key;
  - a `/` inside a regex pattern stays in its segment (`:file{.+/.+}`).
- Wildcards (`*`), static segments and trailing slashes add no params. A path with no params gives `{}`.
- Param values are always `string`. Conversion (model binding, coercion) happens later: `.bind()` in H7 [#118](https://github.com/Laratypes/Laratype/issues/118), or the schema.

### Diagnostics
Type-only (from `types/path.types.ts`): accessing `regex['id{[0-9]+}']`, `optional['user?']` or `wildcard['*']` is an error, and so is a missing required key or a numeric value.

### Example
[`examples/contract/endpoint.ts`](./examples/contract/endpoint.ts) (`PathParams<'/posts/:id{[0-9]+}'>`, `'/files/*'`).

### Non-goals
- Runtime path matching. The router (H1 [#104](https://github.com/Laratypes/Laratype/issues/104)) delegates matching to Hono.

### Open questions
- Resolved: an optional param with `.bind()` is typed `Model | undefined`. An absent param gives `undefined`; a present param with no match gives 404 ([#118](https://github.com/Laratypes/Laratype/issues/118)).

### Acceptance
[#90 Done when](https://github.com/Laratypes/Laratype/issues/90)

---

## Endpoint builder

### Status
merged @ d70daa7 (C1 [#89](https://github.com/Laratypes/Laratype/issues/89); `NoInfer` fix f95d859; copy-before-freeze fix b54ca7c). `.errors()` is available; superseded by planned → [#228](https://github.com/Laratypes/Laratype/issues/228) ([Capabilities and derived errors](#capabilities-and-derived-errors)).

### Public API
[`endpoint.ts` @ d70daa7](https://github.com/Laratypes/Laratype/blob/d70daa77bfceeb99bba44938431535908784a9ce/packages/contract/src/endpoint.ts#L1-L88)

```ts
export type Method = "get" | "post" | "put" | "patch" | "delete";
type Schema = StandardSchemaV1 | undefined;   // internal, not exported

export interface EndpointDef {                // runtime description: router, client, OpenAPI
  readonly method: Method;
  readonly path: string;
  readonly query?: StandardSchemaV1;
  readonly body?: StandardSchemaV1;
  readonly headers?: StandardSchemaV1;
  readonly response?: StandardSchemaV1;
  readonly status: number;
  readonly errors: readonly ErrorDef[];
}

export class Endpoint<M extends Method = Method, P extends string = string,
  Q extends Schema = undefined, B extends Schema = undefined, H extends Schema = undefined,
  R extends Schema = undefined, St extends number = 200, E extends ErrorDef = never> {
  declare readonly __types: { method: M; path: P; params: PathParams<P>; query: Q; body: B;
                              headers: H; response: R; status: St; errors: E };   // phantom
  readonly def: EndpointDef;
  constructor(def: EndpointDef);
  query<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, S, B, H, R, St, E>;
  body<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, Q, S, H, R, St, E>;
  headers<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, Q, B, S, R, St, E>;
  response<S extends StandardSchemaV1, C extends number = 200>(schema: S, status?: C): Endpoint<M, P, Q, B, H, S, NoInfer<C>, E>;
  errors<const Es extends readonly ErrorDef[]>(...errs: Es): Endpoint<M, P, Q, B, H, R, St, E | Es[number]>;
}

export const endpoint: {
  get: <P extends string>(path: P) => Endpoint<"get", P>;
  post: <P extends string>(path: P) => Endpoint<"post", P>;
  put: <P extends string>(path: P) => Endpoint<"put", P>;
  patch: <P extends string>(path: P) => Endpoint<"patch", P>;
  delete: <P extends string>(path: P) => Endpoint<"delete", P>;
};
export type AnyEndpoint = Endpoint<any, any, any, any, any, any, any, any>;
```

### Invariants
- **Immutable.** Every builder call returns a new `Endpoint` and leaves `this` untouched. `def` and `def.errors` are frozen. The constructor copies its argument before freezing, so a caller's object stays mutable (b54ca7c).
- **Order-free.** Slots can be set in any order. A later call to the same slot replaces it. `.errors()` **appends**, in call order.
- **Status.** The default is `200`. `.response(schema, 201)` gives the literal type `201`. Because of `NoInfer<C>`, a contextual return type (for example inside `defineContract`) never infers `C`, so `.response(schema)` at the end of a chain stays `200` (f95d859, regression tests in `types/endpoint.types.ts` and on PR #204).
- **`__types` is phantom.** It has no runtime property and exists only to carry generics. Runtime consumers read `def`. Type consumers read `__types` (or `EndpointTypes<E>`).

### Diagnostics
Type-only (`types/endpoint.types.ts`): unknown method (`endpoint.head`), a non-string path, non-Standard-Schema slots, a string status, a non-`ErrorDef` error, assigning to `def` or its fields, and an unknown path param. At runtime, writing to a frozen `def` throws `TypeError` in strict mode.

### Example
[`examples/contract/endpoint.ts`](./examples/contract/endpoint.ts)

### Non-goals
- No HTTP methods beyond `get | post | put | patch | delete` (no `head`, `options`).
- No middleware in the contract. Middleware belongs to routes (H2/H6). Who may call an endpoint (`auth`, `authorize`, `throttle`) is a contract capability ([Capabilities and derived errors](#capabilities-and-derived-errors)).

### Open questions
- Resolved: per-endpoint middleware is set on the route, with a callback map keyed by endpoint name ([http.md › Route proof at r.contract()](./http.md#route-proof-at-rcontract), [#105](https://github.com/Laratypes/Laratype/issues/105), [#117](https://github.com/Laratypes/Laratype/issues/117)).

### Acceptance
[#89 Done when](https://github.com/Laratypes/Laratype/issues/89)

---

## Error catalog

### Status
merged @ d70daa7 (C4 [#92](https://github.com/Laratypes/Laratype/issues/92)). Available; superseded by planned → [#228](https://github.com/Laratypes/Laratype/issues/228) ([Domain errors](#domain-errors)).

### Public API
[`errors.ts` @ d70daa7](https://github.com/Laratypes/Laratype/blob/d70daa77bfceeb99bba44938431535908784a9ce/packages/contract/src/errors.ts#L1-L36)

```ts
export interface ErrorDef<St extends number = number, Body = unknown> {
  readonly status: St;
  readonly code: string;
  readonly __body?: Body;                 // phantom: carries the body type only
}
export interface MessageBody { message: string }
export interface ValidationErrorBody extends MessageBody { errors: Record<string, string[]> }  // dot path -> messages
export type ErrorStatus<E> = E extends ErrorDef<infer St, any> ? St : never;
export type ErrorBody<E> = E extends ErrorDef<any, infer Body> ? Body : never;
export type ErrorResponse<E> = E extends ErrorDef<infer St, infer Body> ? { status: St; body: Body } : never;  // narrowable by `status`
export const defineError: <St extends number, Body = MessageBody>(status: St, code: string) => ErrorDef<St, Body>;
export const errors: Readonly<{
  unauthorized: ErrorDef<401, MessageBody>;    // "UNAUTHORIZED"
  forbidden: ErrorDef<403, MessageBody>;       // "FORBIDDEN"
  notFound: ErrorDef<404, MessageBody>;        // "NOT_FOUND"
  conflict: ErrorDef<409, MessageBody>;        // "CONFLICT"
  validation: ErrorDef<422, ValidationErrorBody>;  // "VALIDATION_ERROR"
  tooManyRequests: ErrorDef<429, MessageBody>; // "TOO_MANY_REQUESTS"
}>;
```

### Invariants
- An error def is a frozen `{ status, code }` with no runtime body. The body type is phantom.
- The built-in set is exactly the six above, and it is frozen. App-specific errors use `defineError`.
- The 422 body shape `{ message, errors: { "address.zip": ["Required"] } }` is shared by the server (H5 [#108](https://github.com/Laratypes/Laratype/issues/108)) and the client result union (CL2 [#110](https://github.com/Laratypes/Laratype/issues/110)). The [validation adapter](#validation-adapter) produces the `errors` bag.

### Diagnostics
Type-only (`types/errors.types.ts`): a string status, a missing `code`, an explicit status generic that differs from the argument, an unknown built-in (`errors.badRequest`), and writes to built-ins.

### Example
[`examples/contract/endpoint.ts`](./examples/contract/endpoint.ts) (`errors.notFound`, `defineError<402, …>`).

### Non-goals
- No exception classes. Throwing and mapping to responses is H5 [#108](https://github.com/Laratypes/Laratype/issues/108).

### Open questions
- Resolved: thrown errors are checked against the endpoint's `throws` in dev and test ([http.md › Undeclared-error check](./http.md#undeclared-error-check), [#157](https://github.com/Laratypes/Laratype/issues/157)).

### Acceptance
[#92 Done when](https://github.com/Laratypes/Laratype/issues/92)

---

## Validation adapter

### Status
proposed: PR #205 @ 8791758 (C3 [#91](https://github.com/Laratypes/Laratype/issues/91)).

### Public API
[`validate.ts` @ 8791758](https://github.com/Laratypes/Laratype/blob/879175840605c45ee703eaf2a3005ed85337b5e5/packages/contract/src/validate.ts#L1-L50)

```ts
export type ErrorBag = Record<string, string[]>;   // dot path -> messages; "" for issues without a path
export type ValidationResult<O> =
  | { readonly ok: true; readonly value: O }
  | { readonly ok: false; readonly errors: ErrorBag; readonly issues: ReadonlyArray<StandardIssue> };
export const toErrorBag: (issues: ReadonlyArray<StandardIssue>) => ErrorBag;
export const validate: <S extends StandardSchemaV1>(schema: S, value: unknown) => Promise<ValidationResult<InferOut<S>>>;
export const validateSync: <S extends StandardSchemaV1>(schema: S, value: unknown) => ValidationResult<InferOut<S>>;
```

### Invariants
- Invalid input **resolves** to `{ ok: false }`. `validate()` never rejects because of invalid input.
- Paths: `["items", 0, "name"]` becomes `"items.0.name"`. `{ key }` segments are unwrapped. A missing or empty path becomes `""`. Every message for the same path is kept, in order.
- `ErrorBag` has a **null prototype**, so `"__proto__"` stays a plain key. Use `Object.hasOwn(bag, k)` or `k in bag`, never `bag.hasOwnProperty`.
- `validateSync` accepts only sync schemas. It detects any thenable, not just a native `Promise`.
- It works with any Standard Schema vendor. The tests cover zod and valibot (valibot is a devDependency only).

### Diagnostics
- `TypeError: validateSync: the <vendor> schema is async, use validate() instead` (for example `the zod schema`).
- Type-only: passing a non-Standard-Schema value (`{ parse }`, `undefined`) is an error. `result.errors` doesn't exist on success, and `result.value` doesn't exist on failure.

### Example
[`examples/contract/proposed/validate.ts`](./examples/contract/proposed/validate.ts) (checked against PR #205 @ 8791758).

### Non-goals
- No FormRequest, messages or async DB rules here. That is H10 [#137](https://github.com/Laratypes/Laratype/issues/137) in `@laratype/validation`.
- No pipeline wiring. H3 [#106](https://github.com/Laratypes/Laratype/issues/106) calls `validate()` on query, body and headers.

### Open questions
- Zod 4: `z.coerce.number()` has input type `unknown`. Contracts and docs use `z.coerce.number<number>()` (S2 finding, [#85](https://github.com/Laratypes/Laratype/issues/85)).

### Acceptance
[#91 Done when](https://github.com/Laratypes/Laratype/issues/91)

---

## defineContract

### Status
proposed: PR #204 @ ded1bfc (C5 [#93](https://github.com/Laratypes/Laratype/issues/93)). Superseded by planned → [#228](https://github.com/Laratypes/Laratype/issues/228): the name argument goes away, and the name and URL prefix come from the [contract folder tree](#contract-folder-tree).

### Public API
[`contract.ts` @ ded1bfc](https://github.com/Laratypes/Laratype/blob/ded1bfcf76dbbf3b0aadd1886c157e2cf1939dc4/packages/contract/src/contract.ts#L1-L57)

```ts
export const CONTRACT_NAME: unique symbol;            // Symbol.for("laratype.contract")
export type ContractDef = Record<string, AnyEndpoint>;
export type Contract<N extends string = string, D extends ContractDef = ContractDef> = Readonly<D> & { readonly [CONTRACT_NAME]: N };
export type AnyContract = Contract<string, any>;
export type EndpointKeys<C> = Exclude<keyof C, typeof CONTRACT_NAME> & string;             // "index" | "show"
export type ContractName<C> = C extends { readonly [CONTRACT_NAME]: infer N extends string } ? N : never;
export type ContractRouteName<C> = C extends AnyContract ? `${ContractName<C>}.${EndpointKeys<C>}` : never;  // "users.index" | ...
export function defineContract<const N extends string, const D extends ContractDef>(name: N, endpoints: D): Contract<N, D>;
export const isContract: (value: unknown) => value is AnyContract;
export const contractName: <C extends AnyContract>(contract: C) => ContractName<C>;
export const routeName: <C extends AnyContract, K extends EndpointKeys<C>>(contract: C, key: K) => `${ContractName<C>}.${K}`;
export const contractEndpoints: <C extends AnyContract>(contract: C) => Array<[EndpointKeys<C>, AnyEndpoint]>;
```

### Invariants
- The returned contract is frozen, has a null prototype, and holds the endpoints by key in definition order.
- The name brand (`CONTRACT_NAME`) is **non-enumerable**, so it never shows up in keys, spreads or JSON. It uses `Symbol.for`, so two copies of the package agree on it.
- The **route registry name** is `<contract>.<endpoint>` (for example `users.show`). The router, the client, typegen and typed route names (H13) all use this convention.
- The contract name is non-empty and has no empty dot segments, so a dotted name like `admin.users` is allowed. Endpoint keys must not contain `.`.
- Endpoint types are kept exactly as built. `defineContract` never widens the status (NoInfer regression test).

### Diagnostics
Runtime `TypeError`s, all prefixed `[@laratype/contract] `:
- `defineContract: invalid contract name "<name>"`
- `defineContract("<name>"): endpoint key "<key>" must not contain "."`
- `defineContract("<name>"): "<key>" is not an endpoint`

Type-only: `routeName(users, 'nope')` (unknown key) is an error, and a plain record of endpoints is not assignable to `Contract`.

### Example
[`examples/contract/proposed/contracts.ts`](./examples/contract/proposed/contracts.ts) (checked against PR #204 @ ded1bfc).

### Non-goals
- No routes, controllers or middleware. Binding a contract to a controller is `r.contract()` in H2 [#105](https://github.com/Laratypes/Laratype/issues/105).

### Open questions
- None recorded.

### Acceptance
[#93 Done when](https://github.com/Laratypes/Laratype/issues/93)

---

## defineApi and route names

### Status
proposed: PR #204 @ ded1bfc (C5 [#93](https://github.com/Laratypes/Laratype/issues/93)). Superseded by planned → [#133](https://github.com/Laratypes/Laratype/issues/133), [#228](https://github.com/Laratypes/Laratype/issues/228): the hand-written `defineApi({...})` is replaced by the `appApi` generated into `.laratype/api/index.gen.ts`, and route names come from the [contract folder tree](#contract-folder-tree).

### Public API
[`contract.ts` @ ded1bfc](https://github.com/Laratypes/Laratype/blob/ded1bfcf76dbbf3b0aadd1886c157e2cf1939dc4/packages/contract/src/contract.ts#L58-L107)

```ts
// abridged: CheckApi and ApiEndpoint bodies elided, see the permalink
export type ApiDef = Record<string, AnyContract>;
export type CheckApi<A>;                              // per key: the contract, or { error: "defineApi: key \"k\" must match the contract name \"n\"" }
export type Api<A extends ApiDef = ApiDef> = Readonly<A>;
export type ApiRouteName<A> = { [K in keyof A]: ContractRouteName<A[K]> }[keyof A];
export type ApiEndpoint<A, Name extends string>;     // the endpoint behind a registry name
export function defineApi<const A extends ApiDef>(contracts: A & CheckApi<A>): Api<A>;
export const apiRoutes: <A extends ApiDef>(api: Api<A>) => Array<[ApiRouteName<A>, AnyEndpoint]>;
export function apiEndpoint<A extends ApiDef, Name extends ApiRouteName<A>>(api: Api<A>, name: Name): ApiEndpoint<A, Name>;
```

### Invariants
- `app/contracts/index.ts` exports `appApi = defineApi({ ... })` and `type AppApi = typeof appApi`. This is **the only module a FE imports** (S2). `AppRouter` / `typeof routes` is an anti-pattern: the negative-control fixture `fe/bad.ts` shows it pulling server code into the FE program.
- **Each key equals its contract's name**, so `api.users.show` and the registry name `users.show` can never disagree. This is checked at the type level (`CheckApi`) and at runtime.
- The API object is frozen and has a null prototype. `apiRoutes()` lists `[registryName, endpoint]` in definition order (contracts, then endpoints).
- Dotted contract names resolve on the whole name (`apiEndpoint(api, "admin.users.show")`). Endpoint keys never contain `.`, so the last dot splits the name.

### Diagnostics
Runtime `TypeError`s, prefixed `[@laratype/contract] `:
- `defineApi: "<key>" is not a contract (use defineContract)`
- `defineApi: key "<key>" must match the contract name "<name>"`
- `apiEndpoint: unknown route name "<name>"`

Type-level: the same two `defineApi` messages appear as the `error` property of the offending key. `apiEndpoint(appApi, 'users.nope')` is a type error.

### Example
[`examples/contract/proposed/contracts.ts`](./examples/contract/proposed/contracts.ts)

### Non-goals
- No server registration. The router reads `apiRoutes()` (H1/H2).

### Open questions
- None recorded.

### Acceptance
[#93 Done when](https://github.com/Laratypes/Laratype/issues/93)

---

## API type projection

### Status
proposed: PR #204 @ ded1bfc (C5 [#93](https://github.com/Laratypes/Laratype/issues/93)). The `errors` member becomes the [derived error union](#capabilities-and-derived-errors), planned → [#228](https://github.com/Laratypes/Laratype/issues/228).

### Public API
[`api-types.ts` @ ded1bfc](https://github.com/Laratypes/Laratype/blob/ded1bfcf76dbbf3b0aadd1886c157e2cf1939dc4/packages/contract/src/api-types.ts#L1-L47)

```ts
export type EndpointTypes<E extends AnyEndpoint> = {
  method: E["__types"]["method"];
  path: E["__types"]["path"];
  params: E["__types"]["params"];
  query: InferIn<E["__types"]["query"]>;        // schema INPUT: what the FE sends
  body: InferIn<E["__types"]["body"]>;
  headers: InferIn<E["__types"]["headers"]>;
  response: InferOut<E["__types"]["response"]>; // schema OUTPUT: what the server serializes
  status: E["__types"]["status"];
  errors: ErrorResponse<E["__types"]["errors"]>;
};
export type ApiTypes<A> = {
  [C in keyof A]: { [K in EndpointKeys<A[C]>]: A[C][K] extends AnyEndpoint ? EndpointTypes<A[C][K]> : never };
};
export interface EndpointShape { method: string; path: string; params: object; query: unknown; body: unknown;
  headers: unknown; response: unknown; status: number; errors: { status: number; body: unknown } }
export type ApiShape<A> = { [C in keyof A]: { [K in keyof A[C]]: EndpointShape } };
```

### Invariants
- The projection contains plain types only, with no schema types. It is what `@laratype/client` consumes and what `sauf types:generate` prints for separate-repo FEs (S2 option c, G1 [#133](https://github.com/Laratypes/Laratype/issues/133)).
- `ApiShape<A>` is used as a **self-constraint** (`<A extends ApiShape<A>>`). It accepts both `ApiTypes<typeof appApi>` and a generated `interface`. An index-signature constraint would reject interfaces; there is a type test showing this.

### Diagnostics
Type-only: a type that isn't an API shape fails the `ApiShape` constraint.

### Example
[`examples/contract/proposed/contracts.ts`](./examples/contract/proposed/contracts.ts)

### Non-goals
- The projection keeps the schema output (`Date` stays `Date`). The client applies `Jsonify<>` to it ([#110](https://github.com/Laratypes/Laratype/issues/110)).

### Open questions
- Resolved: the response wire type is `Jsonify<output>` ([#107](https://github.com/Laratypes/Laratype/issues/107), [#110](https://github.com/Laratypes/Laratype/issues/110)).

### Acceptance
[#93 Done when](https://github.com/Laratypes/Laratype/issues/93)

---

## Contract folder tree

### Status
planned → [#228](https://github.com/Laratypes/Laratype/issues/228) (C4b, `defineContract<Prefix>`), [#133](https://github.com/Laratypes/Laratype/issues/133) (G1, generated types), [#142](https://github.com/Laratypes/Laratype/issues/142) (G2, watch), [#104](https://github.com/Laratypes/Laratype/issues/104) (H1, runtime scan). It replaces the name argument of [defineContract](#definecontract) and the hand-written [defineApi](#defineapi-and-route-names).

### Design (non-binding)
```ts
// app/api/users/[user]/posts.ts  →  /api/users/:user/posts, client name api.users.posts
import type { Prefix } from './$types'      // the same line in every contract file
export default defineContract<Prefix>({
  index:  endpoint.get('/'),
  update: endpoint.patch('/:post'),
}, { auth: true })
```

- **Source of truth:** the folder tree is the only source of a contract's URL prefix and name. The contract file holds no path prefix and no name.
- **Signature (#228):** `defineContract<Prefix>(endpoints, { auth, throws, throttle })`. The options are the contract level of the [capabilities](#capabilities-and-derived-errors).
- **Root:** the API root folder and its base path are configuration. The default is `app/api` → `/api`.
- **Index files:** `users.ts` and `users/index.ts` are equivalent. Both give `/api/users` and `api.users`. Having both is a scan error.
- **Unique names:** `[x]` folders are dropped from names, so `users/posts.ts` and `users/[user]/posts.ts` would both be `api.users.posts` (`users.posts.*`). Two contracts with the same client or route name are a scan error.
- **Path params:** a `[x]` folder is the path param `:x`. Every contract below it gets `x` in its params and the path-param 404. `[x]` folders don't appear in client names or route names. Paths inside the file add their own params, as before ([Path params](#path-params)).
- **Versioning:** through folders. `app/api/v1/users.ts` gives `/api/v1/users` and `api.v1.users`.
- **Route names:** the folder names plus the endpoint key, for example `users.posts.update` ([URL builder](#url-builder)).
- **Scope files:** `_scope.ts` is a [folder scope](#folder-scopes), not a contract.
- **Generated types:** `sauf dev` and `sauf types:generate` scan the tree for file add, rename and delete, never file contents. They write:
  - a per-folder `$types.d.ts` under `.laratype/types/...` with `Prefix`, overlaid next to the sources through tsconfig `rootDirs`, so `./$types` resolves (the SvelteKit model);
  - `.laratype/api/index.gen.ts` with the aggregated `appApi`. It is a runtime module, not a declaration file, because it holds the contract values and their schemas. The server and the FE import it through the `$api` path alias (`import { appApi } from '$api'`), which tsconfig `paths` and the alias step of the [plugin chain](./build.md#plugin-chain) resolve. It is a convenience: controllers and the FE can also import a contract file directly, with full types ([typegen.md](./typegen.md#sauf-typesgenerate)).
- **Runtime:** in dev the server scans the tree at startup and rescans on change ([#142](https://github.com/Laratypes/Laratype/issues/142)). In production it reads the manifest the build writes ([build.md › Plugin chain](./build.md#plugin-chain)).
- **Cost:** hybrid mode is no longer build-free. Types for a new or renamed folder appear once `sauf dev` or `sauf types:generate` has run.

### Open questions
- A folder syntax for optional path params → [#228](https://github.com/Laratypes/Laratype/issues/228)

### Acceptance
[#228 Done when](https://github.com/Laratypes/Laratype/issues/228) · [#133 Done when](https://github.com/Laratypes/Laratype/issues/133) · [#142 Done when](https://github.com/Laratypes/Laratype/issues/142)

---

## Folder scopes

### Status
planned → [#228](https://github.com/Laratypes/Laratype/issues/228) (C4b, `defineScope`), [#104](https://github.com/Laratypes/Laratype/issues/104) (H1, `r.scope()`). Policies: [#105](https://github.com/Laratypes/Laratype/issues/105) (H2), [#121](https://github.com/Laratypes/Laratype/issues/121) (A3).

### Design (non-binding)
```ts
// app/api/users/[user]/_scope.ts (contract side, FE-visible)
import type { Prefix } from './$types'
export default defineScope<Prefix>({ auth: true, authorize: true })
// every contract under users/[user]/ gets 401 and 403, including files added later
```

- **File:** a folder's `_scope.ts` declares capabilities for every contract in that folder and in its subfolders.
- **Signature (#228):** `defineScope<Prefix>({ auth, authorize, throws, throttle })`.
- **Inheritance:** scope → nested scope → contract → endpoint, per the table in [Capabilities and derived errors](#capabilities-and-derived-errors).
- **Policy:** a scope with `authorize` needs a policy mounted on the server with `r.scope('<folder>', { policy })` ([http.md › Authorization from the contract](./http.md#authorization-from-the-contract)). A missing policy is a compile error in `Route.api` and a runtime error.

### Acceptance
[#228 Done when](https://github.com/Laratypes/Laratype/issues/228) · [#104 Done when](https://github.com/Laratypes/Laratype/issues/104)

---

## Capabilities and derived errors

### Status
planned → [#228](https://github.com/Laratypes/Laratype/issues/228) (C4b, the contract types). Server side: [#120](https://github.com/Laratypes/Laratype/issues/120) (auth), [#105](https://github.com/Laratypes/Laratype/issues/105) (authorize), [#229](https://github.com/Laratypes/Laratype/issues/229) (throttle), [#106](https://github.com/Laratypes/Laratype/issues/106) (422), [#108](https://github.com/Laratypes/Laratype/issues/108) (thrown errors). It supersedes `.errors()` on the [endpoint builder](#endpoint-builder).

### Design (non-binding)
The contract declares what an endpoint needs. The framework derives its own errors from that, and domain errors are declared once with `throws`.

```ts
export default defineContract<Prefix>({
  index:   endpoint.get('/').query(Page).response(UserList),                      // 401, 422
  show:    endpoint.get('/:user').response(UserDto),                              // 401, 404
  store:   endpoint.post('/').body(NewUser).response(UserDto).throws(EmailTaken), // 401, 422, EMAIL_TAKEN
  destroy: endpoint.delete('/:user').authorize(),                                 // 401, 404, 403
  stats:   endpoint.get('/stats').public().response(Stats),                       // none
}, { auth: true })
```

| Contract declares | Error added | Server obligation |
|---|---|---|
| body, query or headers schema | 422 | none (the framework validates) |
| path param (`/:x` or a `[x]` folder) | 404 | none |
| `auth` | 401 | none (the framework applies the guard) |
| `authorize` | 403 | a policy mounted for it, checked at compile time |
| `.throttle(...)` | 429 | none (the framework applies the rate limit) |
| `throws` | each declared domain error | none |

- **`auth`:** `true` uses the default guard and `'<guard>'` a named guard. Guard names are typed from the app's guard registry ([auth.md › Authentication from the contract](./auth.md#authentication-from-the-contract)). A 401 can only come from `auth`; it can't be declared directly.
- **`authorize`:** `authorize: true` on a [scope](#folder-scopes), or `.authorize()` on an endpoint. It requires `auth` at the same level or an outer one, because a policy checks a signed-in user. `.public()` on an endpoint under a scope with `authorize` is a compile error.
- **`throttle`:** `.throttle({ limit, per })` ([http.md › Rate limiting](./http.md#rate-limiting)).
- **`throws`:** `.throws(...errors)` on an endpoint, and `throws: [...]` in the options of a contract or a scope ([Domain errors](#domain-errors)).

Inheritance runs scope → nested scope → contract → endpoint:

| Capability | Levels | Several levels declare it | Opt-out at an inner level |
|---|---|---|---|
| `auth` | scope, contract, endpoint | the nearest wins | `.public()` |
| `throws` | scope, contract, endpoint | the union of all levels | none |
| `throttle` | scope, contract, endpoint | the nearest wins | `.throttle(false)` |
| `authorize` | scope, endpoint | every level runs, outer to inner, then the endpoint | `.authorize(false)` |

- **Opt-outs are endpoint methods:** `.public()`, `.throttle(false)` and `.authorize(false)`. A contract or a scope never removes a capability it inherits. A contract that must be public as a whole sits outside the authenticated scope.
- **`.authorize(false)`** skips every inherited `authorize` check for that endpoint, and its derived 403 goes away.
- **Error union:** an endpoint's error union is every derived error plus the union of its `throws` across all levels. Two errors can share a status (for example `FORBIDDEN` and an app-defined `EMAIL_NOT_VERIFIED` are both 403), so clients narrow by `code` ([client.md › Result union](./client.md#result-union)).
- **Browser-safe:** the capabilities are plain data in `@laratype/contract`. The package stays free of `node:*` imports.

### Non-goals
- No middleware in the contract.
- One rate limit per endpoint: the nearest level wins, and limits don't stack.

### Open questions
- None recorded.

### Acceptance
[#228 Done when](https://github.com/Laratypes/Laratype/issues/228)

---

## Domain errors

### Status
planned → [#228](https://github.com/Laratypes/Laratype/issues/228) (C4b, `defineError` and `throws`). Throwing and mapping to responses: [#108](https://github.com/Laratypes/Laratype/issues/108) (H5). It supersedes the merged [error catalog](#error-catalog).

### Design (non-binding)
```ts
// errors.ts, an FE-importable module
export const EmailTaken = defineError(409, 'EMAIL_TAKEN', (email: string) => ({ email }))

// a service, at any depth: no propagation code
if (await this.emailExists(input.email)) throw EmailTaken(input.email)
```

- **`defineError(status, code, body?)`** returns a throwable factory. `E.is(e)` compares `code`, not `instanceof`, so it works across bundles.
- **Codes** are `UPPER_SNAKE`, like the built-in catalog.
- **Built-in catalog:** `unauthorized` 401, `forbidden` 403, `notFound` 404, `validation` 422 and `tooManyRequests` 429. These are the errors the framework derives. `conflict` 409 is removed: a conflict is a domain error, and the app defines it with `defineError`.
- **Declaring:** `throws` on an endpoint, a contract or a scope. The levels add up ([inheritance](#capabilities-and-derived-errors)).
- **Built-in errors in `throws`:** `throws` also accepts the built-in catalog errors. For example, a search endpoint with no path param whose service throws `notFound` declares `.throws(errors.notFound)`, so the undeclared-error check accepts it.
- **403 from auth:** an unverified or locked account is a domain error, for example `defineError(403, 'EMAIL_NOT_VERIFIED')`. The guard throws it, and the contract or scope declares it with `throws`. There is no separate capability for it.
- **Undeclared errors:** in dev and test, throwing an error the running endpoint doesn't declare is reported, and fails the test ([http.md › Undeclared-error check](./http.md#undeclared-error-check)).
- **Status outside HTTP:** errors carry an HTTP status. Jobs and CLI code that reuse them ignore it.

### Open questions
- None recorded.

### Acceptance
[#228 Done when](https://github.com/Laratypes/Laratype/issues/228) · [#108 Done when](https://github.com/Laratypes/Laratype/issues/108)

---

## URL builder

### Status
planned → [#162](https://github.com/Laratypes/Laratype/issues/162) (H13).

### Design (non-binding)
Issue #162 sketches a pure `buildUrl(endpoint, { params, query })` in `@laratype/contract`. The client (CL1 #109) and a server `route()` helper would share it. Nothing exists in code yet, so the signature is not final.

- **Names:** the folder tree plus the endpoint key, for example `route('users.posts.update', { user, post })` ([Contract folder tree](#contract-folder-tree)).
- **Params:** typed from the path, including the params of parent `[x]` folders. Bound params accept a Model (its route key).
- **Ad-hoc routes** keep explicit names ([http.md › Ad-hoc routes](./http.md#ad-hoc-routes)).

### Acceptance
[#162 Done when](https://github.com/Laratypes/Laratype/issues/162)

---

## Type test suite in CI

### Status
planned → [#94](https://github.com/Laratypes/Laratype/issues/94) (C6).

### Design (non-binding)
Today `packages/contract/__tests__/typecheck.test.ts` compiles `__tests__/types/*.types.ts` (`expectTypeOf` + `@ts-expect-error`) inside the normal `vitest` run. C6 adds a CI job (`vitest --typecheck` per the issue) that must fail on a deliberately broken type.

### Acceptance
[#94 Done when](https://github.com/Laratypes/Laratype/issues/94)
