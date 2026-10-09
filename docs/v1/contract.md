---
area: contract
packages: ["@laratype/contract"]
issues: [89, 90, 91, 92, 93, 94, 162]
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
| [Endpoint builder](#endpoint-builder) | merged @ d70daa7 |
| [Error catalog](#error-catalog) | merged @ d70daa7 |
| [Validation adapter](#validation-adapter) | proposed: PR #205 @ 8791758 |
| [defineContract](#definecontract) | proposed: PR #204 @ ded1bfc |
| [defineApi and route names](#defineapi-and-route-names) | proposed: PR #204 @ ded1bfc |
| [API type projection](#api-type-projection) | proposed: PR #204 @ ded1bfc |
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
- JSON wire types: a `Date` output is typed `Date` but arrives as `string` → [#110](https://github.com/Laratypes/Laratype/issues/110) (CL2), [#107](https://github.com/Laratypes/Laratype/issues/107) (H4).

### Acceptance
[#89 Done when](https://github.com/Laratypes/Laratype/issues/89) · [#91 Done when](https://github.com/Laratypes/Laratype/issues/91)

---

## Path params

### Status
merged @ d70daa7 (C2 [#90](https://github.com/Laratypes/Laratype/issues/90)).

### Public API
[`path.ts` @ d70daa7](https://github.com/Laratypes/Laratype/blob/d70daa77bfceeb99bba44938431535908784a9ce/packages/contract/src/path.ts#L1-L33)

```ts
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
export type PathParams<P extends string>;                // e.g. "/users/:user/posts/:post?" -> { user: string; post?: string }
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
- Optional params combined with `.bind()`: should the bound value be `Model | undefined`? → [#118](https://github.com/Laratypes/Laratype/issues/118)

### Acceptance
[#90 Done when](https://github.com/Laratypes/Laratype/issues/90)

---

## Endpoint builder

### Status
merged @ d70daa7 (C1 [#89](https://github.com/Laratypes/Laratype/issues/89); `NoInfer` fix f95d859; copy-before-freeze fix b54ca7c).

### Public API
[`endpoint.ts` @ d70daa7](https://github.com/Laratypes/Laratype/blob/d70daa77bfceeb99bba44938431535908784a9ce/packages/contract/src/endpoint.ts#L1-L88)

```ts
export type Method = "get" | "post" | "put" | "patch" | "delete";

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

export const endpoint: { get; post; put; patch; delete };   // each: <P extends string>(path: P) => Endpoint<M, P>
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
- No per-endpoint middleware or auth in the contract. Those belong to routes (H2/H6).

### Open questions
- Per-endpoint middleware inside one contract → [#105](https://github.com/Laratypes/Laratype/issues/105), [#117](https://github.com/Laratypes/Laratype/issues/117)

### Acceptance
[#89 Done when](https://github.com/Laratypes/Laratype/issues/89)

---

## Error catalog

### Status
merged @ d70daa7 (C4 [#92](https://github.com/Laratypes/Laratype/issues/92)).

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
export type ErrorStatus<E>;               // status literal(s) of a def or a union of defs
export type ErrorBody<E>;                 // body type(s)
export type ErrorResponse<E>;             // { status: St; body: Body } per def: a union narrowable by `status`
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
- Dev check that a thrown error is declared in `.errors()` → [#157](https://github.com/Laratypes/Laratype/issues/157) (X3 `--strict-contract`)

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
proposed: PR #204 @ ded1bfc (C5 [#93](https://github.com/Laratypes/Laratype/issues/93)).

### Public API
[`contract.ts` @ ded1bfc](https://github.com/Laratypes/Laratype/blob/ded1bfcf76dbbf3b0aadd1886c157e2cf1939dc4/packages/contract/src/contract.ts#L1-L57)

```ts
export const CONTRACT_NAME: unique symbol;            // Symbol.for("laratype.contract")
export type ContractDef = Record<string, AnyEndpoint>;
export type Contract<N extends string = string, D extends ContractDef = ContractDef> = Readonly<D> & { readonly [CONTRACT_NAME]: N };
export type AnyContract = Contract<string, any>;
export type EndpointKeys<C>;                          // "index" | "show" (brand excluded)
export type ContractName<C>;                          // the literal name
export type ContractRouteName<C>;                     // "users.index" | "users.show"
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
proposed: PR #204 @ ded1bfc (C5 [#93](https://github.com/Laratypes/Laratype/issues/93)).

### Public API
[`contract.ts` @ ded1bfc](https://github.com/Laratypes/Laratype/blob/ded1bfcf76dbbf3b0aadd1886c157e2cf1939dc4/packages/contract/src/contract.ts#L58-L107)

```ts
export type ApiDef = Record<string, AnyContract>;
export type CheckApi<A>;                              // per key: the contract, or { error: "defineApi: key \"k\" must match the contract name \"n\"" }
export type Api<A extends ApiDef = ApiDef> = Readonly<A>;
export type ApiRouteName<A>;                          // every registry name in the API
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
proposed: PR #204 @ ded1bfc (C5 [#93](https://github.com/Laratypes/Laratype/issues/93)).

### Public API
[`api-types.ts` @ ded1bfc](https://github.com/Laratypes/Laratype/blob/ded1bfcf76dbbf3b0aadd1886c157e2cf1939dc4/packages/contract/src/api-types.ts#L1-L47)

```ts
export type EndpointTypes<E extends AnyEndpoint> = {
  method; path; params;                  // literal method/path, PathParams<P>
  query: InferIn<Q>; body: InferIn<B>; headers: InferIn<H>;   // schema INPUT: what the FE sends
  response: InferOut<R>;                 // schema OUTPUT: what the server serializes
  status: St;
  errors: ErrorResponse<E>;              // { status, body } union
};
export type ApiTypes<A>;                 // { [contract]: { [endpoint]: EndpointTypes<...> } }
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
- No JSON wire types yet (`Date` stays `Date`). See the open question below.

### Open questions
- Response wire type (`Jsonify<>`) → [#110](https://github.com/Laratypes/Laratype/issues/110), [#107](https://github.com/Laratypes/Laratype/issues/107)

### Acceptance
[#93 Done when](https://github.com/Laratypes/Laratype/issues/93)

---

## URL builder

### Status
planned → [#162](https://github.com/Laratypes/Laratype/issues/162) (H13).

### Design (non-binding)
Issue #162 sketches a pure `buildUrl(endpoint, { params, query })` in `@laratype/contract`. The client (CL1 #109) and a server `route('users.show', { user })` helper would share it. Names would come from `defineApi` and params would be typed from the path. Bound params would accept a Model (its route key). Nothing exists in code yet, so the signature is not final.

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
