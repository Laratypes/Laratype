---
area: contract
packages: ["@laratype/contract"]
issues: [89, 90, 91, 92, 93, 94, 162, 228]
verified-against: Laratype@e2eac4b
last-verified: 2026-10-13
---

# Contract (`@laratype/contract`)

A contract is the single source of truth for one group of endpoints. It is a runtime value, so the router, the client, typegen and OpenAPI all read the same object. The package is browser-safe and has no runtime dependencies. Schemas are any [Standard Schema](https://standardschema.dev) implementation.

Canonical API: the exports of `packages/contract/src/index.ts`. Executable spec: `packages/contract/__tests__/` (runtime tests plus `types/*.types.ts`, compiled by `typecheck.test.ts`).

| Section | Status |
|---|---|
| [Standard Schema types](#standard-schema-types) | merged @ d70daa7; `StandardIssue` merged @ 883a8e2 |
| [Path params](#path-params) | merged @ d70daa7 |
| [Endpoint builder](#endpoint-builder) | merged @ d70daa7; capabilities merged ([#228](https://github.com/Laratypes/Laratype/issues/228)); `.errors()` removed |
| [Error catalog](#error-catalog) | merged @ d70daa7; reshaped, `conflict` removed, merged ([#228](https://github.com/Laratypes/Laratype/issues/228)) |
| [Validation adapter](#validation-adapter) | merged @ 883a8e2 |
| [defineContract](#definecontract) | merged ([#228](https://github.com/Laratypes/Laratype/issues/228)) |
| [defineApi and route names](#defineapi-and-route-names) | merged ([#228](https://github.com/Laratypes/Laratype/issues/228)); generated `appApi` planned → #133 |
| [API type projection](#api-type-projection) | merged @ e2eac4b; nested tree and derived errors merged ([#228](https://github.com/Laratypes/Laratype/issues/228)) |
| [Contract folder tree](#contract-folder-tree) | `ContractPrefix` merged ([#228](https://github.com/Laratypes/Laratype/issues/228)); planned → #133, #142, #104 |
| [Folder scopes](#folder-scopes) | `defineScope` merged ([#228](https://github.com/Laratypes/Laratype/issues/228)); `r.scope()` planned → #104 |
| [Capabilities and derived errors](#capabilities-and-derived-errors) | merged ([#228](https://github.com/Laratypes/Laratype/issues/228)) |
| [Domain errors](#domain-errors) | merged ([#228](https://github.com/Laratypes/Laratype/issues/228)); throwing and mapping planned → #108 |
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
merged @ d70daa7. `StandardIssue` (an extracted named type, with no shape change) is merged @ 883a8e2.

### Public API
[`standard-schema.ts` @ d70daa7](https://github.com/Laratypes/Laratype/blob/d70daa77bfceeb99bba44938431535908784a9ce/packages/contract/src/standard-schema.ts#L1-L17) · [`StandardIssue` @ 883a8e2](https://github.com/Laratypes/Laratype/blob/883a8e27c79fb4ffed4463db0387db7281e617f8/packages/contract/src/standard-schema.ts#L12-L15)

```ts
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}
export interface StandardIssue {                         // C3, merged @ 883a8e2
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
merged @ d70daa7 (C1 [#89](https://github.com/Laratypes/Laratype/issues/89); `NoInfer` fix f95d859; copy-before-freeze fix b54ca7c). The capability methods (`.throws()`, `.auth()`, `.public()`, `.authorize()`, `.throttle()`) are merged ([#228](https://github.com/Laratypes/Laratype/issues/228)), and `.errors()` is removed.

### Public API
[`packages/contract/src/endpoint.ts`](../../packages/contract/src/endpoint.ts)

```ts
export type Method = "get" | "post" | "put" | "patch" | "delete";
type Schema = StandardSchemaV1 | undefined;   // internal, not exported

export interface EndpointDef {                // runtime description: router, client, OpenAPI
  readonly method: Method;
  readonly path: string;                      // relative to the contract's URL prefix
  readonly query?: StandardSchemaV1;
  readonly body?: StandardSchemaV1;
  readonly headers?: StandardSchemaV1;
  readonly response?: StandardSchemaV1;
  readonly status: number;
  readonly throws: readonly AnyErrorDef[];     // .throws(), in call order
  readonly auth?: AuthOption | false;          // false: .public(); unset: inherited
  readonly authorize?: boolean;                // false: .authorize(false); unset: inherited
  readonly throttle?: ThrottleOptions | false; // false: .throttle(false); unset: inherited
}

export interface EndpointCaps { auth: AuthOption | false | undefined; authorize: boolean | undefined; throttle: boolean | undefined }
export type DefaultCaps = { auth: undefined; authorize: undefined; throttle: undefined };

export class Endpoint<M extends Method = Method, P extends string = string,
  Q extends Schema = undefined, B extends Schema = undefined, H extends Schema = undefined,
  R extends Schema = undefined, St extends number = 200, E extends AnyErrorDef = never, C extends EndpointCaps = DefaultCaps> {
  declare readonly __types: { method: M; path: P; params: PathParams<P>; query: Q; body: B;
                              headers: H; response: R; status: St; throws: E; caps: C };   // phantom
  readonly def: EndpointDef;
  constructor(def: EndpointDef);
  query<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, S, B, H, R, St, E, C>;
  body<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, Q, S, H, R, St, E, C>;
  headers<S extends StandardSchemaV1>(schema: S): Endpoint<M, P, Q, B, S, R, St, E, C>;
  response<S extends StandardSchemaV1, Code extends number = 200>(schema: S, status?: Code): Endpoint<M, P, Q, B, H, S, NoInfer<Code>, E, C>;
  throws<const Es extends readonly AnyErrorDef[]>(...errs: Es): Endpoint<M, P, Q, B, H, R, St, E | Es[number], C>;
  auth<const A extends AuthOption = true>(guard?: A): Endpoint<M, P, Q, B, H, R, St, E, { auth: A; authorize: C["authorize"]; throttle: C["throttle"] }>;
  public(): Endpoint<M, P, Q, B, H, R, St, E, { auth: false; authorize: C["authorize"]; throttle: C["throttle"] }>;
  authorize<const F extends boolean = true>(enabled?: F): Endpoint<M, P, Q, B, H, R, St, E, { auth: C["auth"]; authorize: F; throttle: C["throttle"] }>;
  throttle<const T extends ThrottleOptions | false>(options: T): Endpoint<M, P, Q, B, H, R, St, E, { auth: C["auth"]; authorize: C["authorize"]; throttle: T extends false ? false : true }>;
}

export const endpoint: {
  get: <P extends string>(path: P) => Endpoint<"get", P>;
  post: <P extends string>(path: P) => Endpoint<"post", P>;
  put: <P extends string>(path: P) => Endpoint<"put", P>;
  patch: <P extends string>(path: P) => Endpoint<"patch", P>;
  delete: <P extends string>(path: P) => Endpoint<"delete", P>;
};
export type AnyEndpoint = Endpoint<any, any, any, any, any, any, any, any, any>;
```

### Invariants
- **Immutable.** Every builder call returns a new `Endpoint` and leaves `this` untouched. `def`, `def.throws` and the throttle options are frozen. The constructor copies its argument before freezing, so a caller's object stays mutable (b54ca7c).
- **Order-free.** Slots can be set in any order. A later call to the same slot replaces it. `.throws()` **appends**, in call order.
- **Status.** The default is `200`. `.response(schema, 201)` gives the literal type `201`. Because of `NoInfer<Code>`, a contextual return type (for example inside `defineContract`) never infers the status, so `.response(schema)` at the end of a chain stays `200` (f95d859, regression tests in `types/endpoint.types.ts` and `types/contract.types.ts`).
- **Relative paths.** The path is appended to the contract's URL prefix from the [folder tree](#contract-folder-tree). `'/'` is the prefix itself.
- **Capabilities.** The builder holds the endpoint level of the [capabilities](#capabilities-and-derived-errors), and an unset capability is inherited. `.auth()` uses the default guard and `.auth('<guard>')` a named one. `.public()`, `.authorize(false)` and `.throttle(false)` are the only opt-outs.
- **`__types` is phantom.** It has no runtime property and exists only to carry generics. Runtime consumers read `def`. Type consumers read `__types` (or `EndpointTypes<E, Ctx>`).

### Diagnostics
Type-only (`types/endpoint.types.ts`): unknown method (`endpoint.head`), a non-string path, non-Standard-Schema slots, a string status, a `.throws()` value that is not an error factory, `.errors()` (removed), a guard missing from `GuardRegistry`, a throttle without `limit` or with an unknown unit, `.throttle(true)`, assigning to `def` or its fields, and an unknown path param.

Runtime `TypeError`s, all prefixed `[@laratype/contract] `:
- `throws(): throws must be a list of errors (use defineError)`
- `auth(): auth must be true or a guard name`
- `authorize(): expected a boolean`
- `throttle(): throttle must be { limit: positive integer, per: seconds or "<n>s|m|h|d" }`

Writing to a frozen `def` throws `TypeError` in strict mode.

### Example
[`examples/contract/endpoint.ts`](./examples/contract/endpoint.ts)

### Non-goals
- No HTTP methods beyond `get | post | put | patch | delete` (no `head`, `options`).
- No middleware in the contract. Middleware belongs to routes (H2/H6). Who may call an endpoint (`auth`, `authorize`, `throttle`) is a contract capability ([Capabilities and derived errors](#capabilities-and-derived-errors)).

### Open questions
- Resolved: per-endpoint middleware is set on the route, with a callback map keyed by endpoint name ([http.md › Route proof at r.contract()](./http.md#route-proof-at-rcontract), [#105](https://github.com/Laratypes/Laratype/issues/105), [#117](https://github.com/Laratypes/Laratype/issues/117)).

### Acceptance
[#89 Done when](https://github.com/Laratypes/Laratype/issues/89) · [#228 Done when](https://github.com/Laratypes/Laratype/issues/228)

---

## Error catalog

### Status
merged @ d70daa7 (C4 [#92](https://github.com/Laratypes/Laratype/issues/92)). Reshaped by C4b, merged ([#228](https://github.com/Laratypes/Laratype/issues/228)): the built-ins are [domain error](#domain-errors) factories, codes are `UPPER_SNAKE`, and `conflict` is removed.

### Public API
[`packages/contract/src/errors.ts`](../../packages/contract/src/errors.ts)

```ts
export interface MessageBody { message: string }
export interface ValidationErrorBody extends MessageBody { errors: Record<string, string[]> }  // dot path -> messages
export const errors: Readonly<{
  unauthorized: ErrorDef<401, "UNAUTHORIZED", MessageBody, [message?: string]>;
  forbidden: ErrorDef<403, "FORBIDDEN", MessageBody, [message?: string]>;
  notFound: ErrorDef<404, "NOT_FOUND", MessageBody, [message?: string]>;
  validation: ErrorDef<422, "VALIDATION_ERROR", ValidationErrorBody, [errors: ErrorBag, message?: string]>;
  tooManyRequests: ErrorDef<429, "TOO_MANY_REQUESTS", MessageBody, [message?: string]>;
}>;
```

### Invariants
- The built-in set is exactly the five above, and it is frozen. These are the errors the framework [derives](#capabilities-and-derived-errors). App-specific errors, conflicts included, use [`defineError`](#domain-errors).
- The default messages are `Unauthenticated.`, `This action is unauthorized.`, `Not Found.`, `The given data was invalid.` and `Too Many Requests.`
- The 422 body shape `{ message, errors: { "address.zip": ["Required"] } }` is shared by the server (H5 [#108](https://github.com/Laratypes/Laratype/issues/108)) and the client result union (CL2 [#110](https://github.com/Laratypes/Laratype/issues/110)). The [validation adapter](#validation-adapter) produces the `errors` bag.

### Diagnostics
Type-only (`types/errors.types.ts`): an unknown built-in (`errors.conflict`), writes to the built-ins or their fields, and reading `issues` on the 422 body.

### Example
[`examples/contract/validate.ts`](./examples/contract/validate.ts) (`errors.validation(result.errors).body`) · [`examples/contract/endpoint.ts`](./examples/contract/endpoint.ts) (`.throws(errors.notFound)`).

### Non-goals
- No exception mapping here. Turning a thrown error into a response is H5 [#108](https://github.com/Laratypes/Laratype/issues/108).

### Open questions
- Resolved: thrown errors are checked against the endpoint's `throws` in dev and test ([http.md › Undeclared-error check](./http.md#undeclared-error-check), [#157](https://github.com/Laratypes/Laratype/issues/157)).

### Acceptance
[#92 Done when](https://github.com/Laratypes/Laratype/issues/92) · [#228 Done when](https://github.com/Laratypes/Laratype/issues/228)

---

## Validation adapter

### Status
merged @ 883a8e2 (C3 [#91](https://github.com/Laratypes/Laratype/issues/91)).

### Public API
[`validate.ts` @ 883a8e2](https://github.com/Laratypes/Laratype/blob/883a8e27c79fb4ffed4463db0387db7281e617f8/packages/contract/src/validate.ts#L1-L50)

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
[`examples/contract/validate.ts`](./examples/contract/validate.ts).

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
merged ([#228](https://github.com/Laratypes/Laratype/issues/228)). It replaces the named `defineContract(name, endpoints)` of C5 ([#93](https://github.com/Laratypes/Laratype/issues/93), e2eac4b). A contract's name and URL prefix now come from the [contract folder tree](#contract-folder-tree).

### Public API
[`packages/contract/src/contract.ts`](../../packages/contract/src/contract.ts)

```ts
export const CONTRACT: unique symbol;                 // Symbol.for("laratype.contract")
export type ContractDef = Record<string, AnyEndpoint>;
export interface ContractMeta<P extends AnyPrefix = AnyPrefix, O extends ContractOptions = ContractOptions> {
  readonly options: O;
  readonly prefix?: P;                                // phantom: the folder context, type-only
}
export type Contract<P extends AnyPrefix = AnyPrefix, D extends ContractDef = ContractDef, O extends ContractOptions = ContractOptions> =
  Readonly<D> & { readonly [CONTRACT]: ContractMeta<P, O> };
export type AnyContract = Contract<any, any, any>;
export type EndpointKeys<C> = Exclude<keyof C, typeof CONTRACT> & string;             // "index" | "show"
export type ContractPrefixOf<C>;                      // the Prefix a contract was defined with
export type ContractOptionsOf<C>;                     // its options
export type ContractContext<P extends AnyPrefix, O extends ContractOptions> = { path: PrefixPath<P>; scopes: PrefixScopes<P>; options: O };
export type CheckEndpoints<D, Ctx extends EndpointContext>;   // per key: the endpoint, or { error: "<key>: <CapabilityProblem>" }

export const defineContract: <P extends AnyPrefix = ContractPrefix>() =>
  <const D extends ContractDef, const O extends ContractOptions = {}>(
    endpoints: D & CheckEndpoints<D, ContractContext<P, O>>, options?: O) => Contract<P, D, O>;
export const isContract: (value: unknown) => value is AnyContract;
export const contractEndpoints: <C extends AnyContract>(contract: C) => Array<[EndpointKeys<C>, AnyEndpoint]>;
```

### Invariants
- **No name.** A contract file holds no name and no URL prefix. Both come from its place in the [folder tree](#contract-folder-tree), and a contract gets them when it is mounted in an [API tree](#defineapi-and-route-names). `CONTRACT_NAME`, `ContractName`, `ContractRouteName`, `contractName` and `routeName` are removed.
- **Curried call.** `defineContract<Prefix>()(endpoints, options)`. TypeScript can't infer the endpoints once `Prefix` is passed explicitly (it has no partial type-argument inference), so the `Prefix` call comes first. `defineContract()(...)` is a root-level contract with no folder context.
- **Options** are the contract level of the [capabilities](#capabilities-and-derived-errors): `{ auth, throws, throttle }`. They are validated, frozen, and kept on the non-enumerable `[CONTRACT]` brand, so they never show up in keys, spreads or JSON. The brand uses `Symbol.for`, so two copies of the package agree on it.
- The returned contract is frozen, has a null prototype, and holds the endpoints by key in definition order.
- Endpoint keys are non-empty and contain no `.`.
- Endpoint types are kept exactly as built. `defineContract` never widens the status (NoInfer regression test).

### Diagnostics
Runtime `TypeError`s, all prefixed `[@laratype/contract] `:
- `defineContract: endpoint key "<key>" must be non-empty and must not contain "."`
- `defineContract: "<key>" is not an endpoint`
- `defineContract: unknown option "<option>"`, and the option checks `auth must be true or a guard name`, `throws must be a list of errors (use defineError)` and `throttle must be { limit: positive integer, per: seconds or "<n>s|m|h|d" }`

Type-level: a plain record of endpoints is not assignable to `Contract`. An endpoint with inconsistent capabilities gets `{ error: "<key>: <problem>" }` ([Capabilities and derived errors](#capabilities-and-derived-errors)). `authorize` and `auth: false` are not contract options.

### Example
[`examples/contract/contracts.ts`](./examples/contract/contracts.ts).

### Non-goals
- No routes, controllers or middleware. Binding a contract to a controller is `r.contract()` in H2 [#105](https://github.com/Laratypes/Laratype/issues/105).

### Open questions
- None recorded.

### Acceptance
[#93 Done when](https://github.com/Laratypes/Laratype/issues/93) · [#228 Done when](https://github.com/Laratypes/Laratype/issues/228)

---

## defineApi and route names

### Status
merged ([#228](https://github.com/Laratypes/Laratype/issues/228)): the API tree built from flat tree names, replacing the hand-written `defineApi({ users, posts })` of C5 ([#93](https://github.com/Laratypes/Laratype/issues/93), e2eac4b). Generating the `appApi` module (`.laratype/api/index.gen.ts`) is planned → [#133](https://github.com/Laratypes/Laratype/issues/133).

### Public API
[`packages/contract/src/contract.ts`](../../packages/contract/src/contract.ts)

```ts
export const API_NODE: unique symbol;                 // Symbol.for("laratype.api")
export interface ApiEntry<C extends AnyContract = AnyContract, Path extends string = string, S extends readonly AnyScope[] = readonly AnyScope[]> {
  readonly contract: C;
  readonly path: Path;                                // full URL prefix, file segment included: "/api/users/:user/posts"
  readonly scopes: S;                                 // the _scope.ts chain, outer to inner
}
export type ApiDef = Record<string, ApiEntry>;        // keyed by tree name: "users", "users.posts"
export interface ApiNodeInfo<N extends string = string, En = ApiEntry | undefined> { readonly name: N; readonly entry: En }
export type CheckApi<A>;                              // per key: the entry, or { error: "defineApi: ..." }
export type Api<A extends ApiDef = ApiDef>;           // the nested tree: api.users.posts.update
export type ApiNode<A, H extends string, Name extends string>;   // endpoints & child nodes & { [API_NODE]: ApiNodeInfo }
export type ApiRouteName<A>;                          // "users.index" | "users.posts.update" | ...
export type ApiEndpoint<A, Name extends string>;     // the endpoint behind a route name
export type EntryContext<En>;                         // { path, scopes, options } of a mounted contract
export type NodeContext<N>;
export function defineApi<const A extends ApiDef>(entries: A & CheckApi<A>): Api<A>;

export interface ApiRoute<N extends string = string> extends ResolvedCapabilities {
  readonly name: N;
  readonly method: Method;
  readonly path: string;                              // full path
  readonly endpoint: AnyEndpoint;
  readonly contract: AnyContract;
  readonly scopes: readonly AnyScope[];
}
export function apiRoutes<A extends ApiDef>(api: Api<A>): Array<ApiRoute<ApiRouteName<Api<A>>>>;
export function apiEndpoint<A extends ApiDef, Name extends ApiRouteName<Api<A>> & string>(api: Api<A>, name: Name): ApiEndpoint<Api<A>, Name>;
```

The module `.laratype/api/index.gen.ts` (G1 [#133](https://github.com/Laratypes/Laratype/issues/133)) calls `defineApi` with one entry per contract file:

```ts
export const appApi = defineApi({
  'users':       { contract: users, path: '/api/users', scopes: [] },
  'users.posts': { contract: usersPosts, path: '/api/users/:user/posts', scopes: [usersUserScope] },
})
export type AppApi = typeof appApi
```

### Invariants
- **Tree names.** A key is the folder names plus the file name, joined with `.` (`users.posts`). `[x]` folders are dropped. The result is nested: `appApi.users.posts.update`. Folders without a contract file become pure nodes (`v1` in `v1.health`).
- **Route names** are the tree name plus the endpoint key (`users.posts.update`). The router, the client, typegen and the [URL builder](#url-builder) use this convention.
- **Nodes.** Each node is frozen, has a null prototype, and holds its contract's endpoints and its child nodes in definition order. A non-enumerable `[API_NODE]` holds `{ name, entry }`, and `entry` is `undefined` for a pure folder.
- **Name clashes.** An endpoint key and a child node with the same name are an error, at the type level (`CheckApi`) and at runtime.
- **Folder prefix.** At the type level, the entry `path` must start with the contract's `Prefix` path.
- **Capability re-check.** `defineApi` re-checks the [capability rules](#capabilities-and-derived-errors) against the runtime scope chain, so a `.public()` endpoint under a scope with `authorize` fails here too.
- **`apiRoutes()`** lists every route depth-first in definition order. Each route has its full path and its resolved capabilities: `auth`, `authorize`, `throttle`, and `errors`, which holds the derived errors plus `throws` from every level, unique by code. The router (H1), the policies (H2), the exception filter (H5) and the undeclared-error check (X3) read it.
- **The FE imports the `appApi` module only**, never `typeof routes`. The negative-control fixture `fe/bad.ts` shows `typeof routes` pulling server code into the FE program.

### Diagnostics
Runtime `TypeError`s, prefixed `[@laratype/contract] `:
- `defineApi: invalid tree name "<name>"`
- `defineApi: "<name>" must be { contract, path, scopes }`
- `defineApi: "<name>" path must start with "/"`
- `defineApi: "<name>" scopes must be scopes (use defineScope)`
- `defineApi: "<name>": scope <i> has authorize but no auth in it or an outer scope`
- `defineApi: "<name>" is both an endpoint and a contract`
- `<route name>: .public() under a scope with authorize: add .authorize(false) or move the contract out of the scope`
- `<route name>: .authorize() needs auth on the endpoint, its contract or a scope`
- `apiEndpoint: unknown route name "<name>"`

Type-level, as the `error` property of the offending key: `defineApi: invalid tree name "<name>"`, `defineApi: "<name>" path must start with its folder prefix "<prefix>"`, `defineApi: "<name>" has an endpoint and a child contract with the same name`, `defineApi: "<name>" must be { contract, path, scopes }`. `apiEndpoint(appApi, 'users.nope')` and `apiEndpoint(appApi, 'users.posts')` (a node) are type errors.

### Example
[`examples/contract/contracts.ts`](./examples/contract/contracts.ts)

### Non-goals
- No server registration. The router reads `apiRoutes()` (H1/H2).
- No folder scan. Generating the entries is G1 [#133](https://github.com/Laratypes/Laratype/issues/133); scanning at runtime is H1 [#104](https://github.com/Laratypes/Laratype/issues/104).

### Open questions
- None recorded.

### Acceptance
[#93 Done when](https://github.com/Laratypes/Laratype/issues/93) · [#228 Done when](https://github.com/Laratypes/Laratype/issues/228) · [#133 Done when](https://github.com/Laratypes/Laratype/issues/133)

---

## API type projection

### Status
merged @ e2eac4b (C5 [#93](https://github.com/Laratypes/Laratype/issues/93)). Nested trees, full paths and the derived error union are merged ([#228](https://github.com/Laratypes/Laratype/issues/228)).

### Public API
[`packages/contract/src/api-types.ts`](../../packages/contract/src/api-types.ts)

```ts
export type EndpointTypes<E extends AnyEndpoint, Ctx extends EndpointContext = RootContext> = {
  method: E["__types"]["method"];
  path: JoinPath<Ctx["path"], E["__types"]["path"]>;               // full path
  params: PathParams<JoinPath<Ctx["path"], E["__types"]["path"]>>; // folder params included
  query: InferIn<E["__types"]["query"]>;        // schema INPUT: what the FE sends
  body: InferIn<E["__types"]["body"]>;
  headers: InferIn<E["__types"]["headers"]>;
  response: InferOut<E["__types"]["response"]>; // schema OUTPUT: what the server serializes
  status: E["__types"]["status"];
  errors: ErrorResponse<EndpointErrors<E, Ctx>>; // { status, code, body } per derived or declared error
};
export type ApiTypes<A> = {
  [K in keyof A & string]: A[K] extends AnyEndpoint ? EndpointTypes<A[K], NodeContext<A>> : ApiTypes<A[K]>;
};
export interface EndpointShape { method: string; path: string; params: object; query: unknown; body: unknown;
  headers: unknown; response: unknown; status: number; errors: { status: number; code: string; body: unknown } }
export type ApiShape<A> = { [K in keyof A]: A[K] extends { method: string } ? EndpointShape : ApiShape<A[K]> };
```

### Invariants
- The projection contains plain types only, with no schema types. It is what `@laratype/client` consumes and what `sauf types:generate` prints for separate-repo FEs (S2 option c, G1 [#133](https://github.com/Laratypes/Laratype/issues/133)).
- It follows the API tree: `ApiTypes<AppApi>['users']['posts']['update']`. `path` is the full path and `params` include the `[x]` folder params.
- `errors` is the [derived error union](#capabilities-and-derived-errors). Two errors can share a status, so clients narrow by `code`.
- `ApiShape<A>` is used as a **self-constraint** (`<A extends ApiShape<A>>`). It accepts both `ApiTypes<typeof appApi>` and a generated `interface`. A member with a `method` is an endpoint; any other member is a nested group. An index-signature constraint would reject interfaces; there is a type test showing this.
- `EndpointTypes<E>` without a context is the endpoint on its own: its relative path and only its own capabilities.

### Diagnostics
Type-only: a type that isn't an API shape fails the `ApiShape` constraint, and so does an error member without `code`.

### Example
[`examples/contract/contracts.ts`](./examples/contract/contracts.ts)

### Non-goals
- The projection keeps the schema output (`Date` stays `Date`). The client applies `Jsonify<>` to it ([#110](https://github.com/Laratypes/Laratype/issues/110)).

### Open questions
- Resolved: the response wire type is `Jsonify<output>` ([#107](https://github.com/Laratypes/Laratype/issues/107), [#110](https://github.com/Laratypes/Laratype/issues/110)).

### Acceptance
[#93 Done when](https://github.com/Laratypes/Laratype/issues/93) · [#228 Done when](https://github.com/Laratypes/Laratype/issues/228)

---

## Contract folder tree

### Status
The contract side is merged ([#228](https://github.com/Laratypes/Laratype/issues/228)): `ContractPrefix`, `defineContract<Prefix>()` and the `defineApi` tree. The generated types and `appApi` are planned → [#133](https://github.com/Laratypes/Laratype/issues/133) (G1), the watch → [#142](https://github.com/Laratypes/Laratype/issues/142) (G2), and the runtime scan → [#104](https://github.com/Laratypes/Laratype/issues/104) (H1).

### Public API
[`packages/contract/src/capabilities.ts`](../../packages/contract/src/capabilities.ts)

```ts
// type-only: never a runtime value
export interface ContractPrefix<Path extends string = "", Scopes extends readonly AnyScope[] = []> {
  readonly __prefix: { path: Path; scopes: Scopes };  // phantom
}
export type AnyPrefix = ContractPrefix<string, readonly AnyScope[]>;
export type PrefixPath<P extends AnyPrefix> = P["__prefix"]["path"];
export type PrefixScopes<P extends AnyPrefix> = P["__prefix"]["scopes"];
```

```ts
// app/api/users/[user]/posts.ts  →  /api/users/:user/posts, client name api.users.posts
import type { Prefix } from './$types'      // the same line in every contract file
export default defineContract<Prefix>()({
  index:  endpoint.get('/'),
  update: endpoint.patch('/:post'),
}, { auth: true })
```

### Invariants
- **`Prefix`** is what each folder's generated `$types.d.ts` exports for the contracts in that folder. `Path` is the folder URL, with each `[x]` folder written as `:x`. `Scopes` is the `_scope.ts` chain from outer to inner, including the folder's own scope. The contract file's own segment (`posts`) adds no params and is not part of `Prefix`.
- **`ScopePrefix`** is what the same `$types.d.ts` exports for the folder's `_scope.ts`. It holds the outer scopes only: a scope that appeared in its own `Prefix` would be a circular type.
- **Folder params:** every contract below a `[x]` folder gets `x` in its params and the path-param 404, typed from `Prefix`.
- **Source of truth:** the folder tree is the only source of a contract's URL prefix and name. The contract file holds neither.

Generated `$types.d.ts` for `app/api/users/[user]/` (G1 [#133](https://github.com/Laratypes/Laratype/issues/133) emits it; the shape is fixed here):
```ts
import type { ContractPrefix } from '@laratype/contract'
export type Prefix = ContractPrefix<'/api/users/:user', [typeof import('./_scope').default]>
export type ScopePrefix = ContractPrefix<'/api/users/:user', []>
```

### Design (non-binding)
The parts that G1, G2 and H1 will build:
- **Root:** the API root folder and its base path are configuration. The default is `app/api` → `/api`.
- **Index files:** `users.ts` and `users/index.ts` are equivalent. Both give `/api/users` and `api.users`. Having both is a scan error.
- **Unique names:** `[x]` folders are dropped from names, so `users/posts.ts` and `users/[user]/posts.ts` would both be `api.users.posts` (`users.posts.*`). Two contracts with the same client or route name are a scan error.
- **Versioning:** through folders. `app/api/v1/users.ts` gives `/api/v1/users` and `api.v1.users`.
- **Route names:** the folder names plus the endpoint key, for example `users.posts.update` ([defineApi and route names](#defineapi-and-route-names), [URL builder](#url-builder)).
- **Scope files:** `_scope.ts` is a [folder scope](#folder-scopes), not a contract.
- **Generated types:** `sauf dev` and `sauf types:generate` scan the tree for file add, rename and delete, never file contents. They write:
  - a per-folder `$types.d.ts` under `.laratype/types/...` with `Prefix` and `ScopePrefix`, overlaid next to the sources through tsconfig `rootDirs`, so `./$types` resolves (the SvelteKit model);
  - `.laratype/api/index.gen.ts` with the aggregated `appApi`, built with [`defineApi`](#defineapi-and-route-names). It is a runtime module, not a declaration file, because it holds the contract values and their schemas. The server and the FE import it through the `$api` path alias (`import { appApi } from '$api'`), which tsconfig `paths` and the alias step of the [plugin chain](./build.md#plugin-chain) resolve. It is a convenience: controllers and the FE can also import a contract file directly, with full types ([typegen.md](./typegen.md#sauf-typesgenerate)).
- **Runtime:** in dev the server scans the tree at startup and rescans on change ([#142](https://github.com/Laratypes/Laratype/issues/142)). In production it reads the manifest the build writes ([build.md › Plugin chain](./build.md#plugin-chain)).
- **Cost:** hybrid mode is no longer build-free. Types for a new or renamed folder appear once `sauf dev` or `sauf types:generate` has run.

### Open questions
- A folder syntax for optional path params → [#228](https://github.com/Laratypes/Laratype/issues/228)

### Acceptance
[#228 Done when](https://github.com/Laratypes/Laratype/issues/228) · [#133 Done when](https://github.com/Laratypes/Laratype/issues/133) · [#142 Done when](https://github.com/Laratypes/Laratype/issues/142)

---

## Folder scopes

### Status
`defineScope` is merged ([#228](https://github.com/Laratypes/Laratype/issues/228)). `r.scope()` is planned → [#104](https://github.com/Laratypes/Laratype/issues/104) (H1). Policies: [#105](https://github.com/Laratypes/Laratype/issues/105) (H2), [#121](https://github.com/Laratypes/Laratype/issues/121) (A3).

### Public API
[`packages/contract/src/contract.ts`](../../packages/contract/src/contract.ts) · [`packages/contract/src/capabilities.ts`](../../packages/contract/src/capabilities.ts)

```ts
export const SCOPE: unique symbol;                    // Symbol.for("laratype.scope")
export type Scope<O extends ScopeOptions = ScopeOptions> = Readonly<O> & { readonly [SCOPE]: true };
export type AnyScope = Scope<ScopeOptions>;
export type CheckScope<P extends AnyPrefix, O>;       // { error: "defineScope: authorize needs auth in this scope or an outer one" } or unknown
export const defineScope: <P extends AnyPrefix = ContractPrefix>() =>
  <const O extends ScopeOptions>(options: O & CheckScope<P, O>) => Scope<O>;
export const isScope: (value: unknown) => value is AnyScope;
```

```ts
// app/api/users/[user]/_scope.ts (contract side, FE-visible)
import type { ScopePrefix } from './$types'
export default defineScope<ScopePrefix>()({ auth: true, authorize: true })
// every contract under users/[user]/ gets 401 and 403, including files added later
```

### Invariants
- **File:** a folder's `_scope.ts` declares capabilities for every contract in that folder and in its subfolders.
- **Options:** `{ auth, authorize, throws, throttle }`. A scope is its validated options, frozen, with a null prototype and the non-enumerable `[SCOPE]` brand. A scope never opts out: `auth: false` and `throttle: false` are rejected.
- **`authorize` needs `auth`** in the same scope or an outer one (`ScopePrefix`). This is checked in `defineScope` and again by `defineApi` against the runtime chain.
- **Inheritance:** scope → nested scope → contract → endpoint, per the table in [Capabilities and derived errors](#capabilities-and-derived-errors).

### Diagnostics
- Type-level: `defineScope: authorize needs auth in this scope or an outer one` (the `error` property of the options).
- Runtime, prefixed `[@laratype/contract] `: `defineScope: unknown option "<option>"`, `defineScope: authorize must be a boolean`, and the shared option checks (see [defineContract](#definecontract)).

### Design (non-binding)
- **Policy:** a scope with `authorize` needs a policy mounted on the server with `r.scope('<folder>', { policy })` ([http.md › Authorization from the contract](./http.md#authorization-from-the-contract)). A missing policy is a compile error in `Route.api` and a runtime error.

### Acceptance
[#228 Done when](https://github.com/Laratypes/Laratype/issues/228) · [#104 Done when](https://github.com/Laratypes/Laratype/issues/104)

---

## Capabilities and derived errors

### Status
merged ([#228](https://github.com/Laratypes/Laratype/issues/228)): the contract types and their runtime resolution. Server side: [#120](https://github.com/Laratypes/Laratype/issues/120) (auth), [#105](https://github.com/Laratypes/Laratype/issues/105) (authorize), [#229](https://github.com/Laratypes/Laratype/issues/229) (throttle), [#106](https://github.com/Laratypes/Laratype/issues/106) (422), [#108](https://github.com/Laratypes/Laratype/issues/108) (thrown errors).

### Public API
[`packages/contract/src/capabilities.ts`](../../packages/contract/src/capabilities.ts)

```ts
export interface GuardRegistry {}                     // augmented by the app: declare module '@laratype/contract' { interface GuardRegistry { api: true } }
export type GuardName = keyof GuardRegistry & string;
export type AuthOption = true | GuardName;
export type Duration = number | `${number}${"s" | "m" | "h" | "d"}`;   // a number is seconds
export interface ThrottleOptions { readonly limit: number; readonly per: Duration }
export interface ContractOptions { readonly auth?: AuthOption; readonly throws?: readonly AnyErrorDef[]; readonly throttle?: ThrottleOptions }
export interface ScopeOptions extends ContractOptions { readonly authorize?: boolean }

export interface EndpointContext { readonly path: string; readonly scopes: readonly AnyScope[]; readonly options: ContractOptions }
export type RootContext = { path: ""; scopes: []; options: {} };
export type JoinPath<A extends string, B extends string>;          // "/api/users" + "/:user"; "/" is the prefix itself
export type ResolvedAuth<E extends AnyEndpoint, Ctx extends EndpointContext = RootContext>;       // the nearest auth, or false/undefined
export type ResolvedAuthorize<E extends AnyEndpoint, Ctx extends EndpointContext = RootContext>;  // true when a policy check runs
export type EndpointErrors<E extends AnyEndpoint, Ctx extends EndpointContext = RootContext>;     // derived errors | throws of every level
export type CapabilityProblem<E extends AnyEndpoint, Ctx extends EndpointContext>;                // a message, or never

export interface ResolvedCapabilities {
  readonly auth: AuthOption | undefined;
  readonly authorize: boolean;
  readonly throttle: ThrottleOptions | undefined;
  readonly errors: readonly AnyErrorDef[];
}
export function resolveCapabilities(def: EndpointDef, ctx: { readonly path: string; readonly scopes: readonly ScopeOptions[]; readonly options: ContractOptions }, label: string): ResolvedCapabilities;
```

```ts
export default defineContract<Prefix>()({
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

Inheritance runs scope → nested scope → contract → endpoint:

| Capability | Levels | Several levels declare it | Opt-out at an inner level |
|---|---|---|---|
| `auth` | scope, contract, endpoint | the nearest wins | `.public()` |
| `throws` | scope, contract, endpoint | the union of all levels | none |
| `throttle` | scope, contract, endpoint | the nearest wins | `.throttle(false)` |
| `authorize` | scope, endpoint | every level runs, outer to inner, then the endpoint | `.authorize(false)` |

### Invariants
- **`auth`:** `true` uses the default guard and `'<guard>'` a named guard. Guard names are the keys of `GuardRegistry`, an empty interface the app augments ([auth.md › Authentication from the contract](./auth.md#authentication-from-the-contract); A1 [#119](https://github.com/Laratypes/Laratype/issues/119) will feed it from the auth `Register`). A 401 can only come from `auth`; it can't be declared directly.
- **`authorize`:** `authorize: true` on a [scope](#folder-scopes), or `.authorize()` on an endpoint. It requires `auth` at the same level or an outer one, because a policy checks a signed-in user.
- **`.public()` under a scope with `authorize`** is a compile error, unless the endpoint also has `.authorize(false)`: `.public().authorize(false)` runs no guard and no policy.
- **`throttle`:** `.throttle({ limit, per })` ([http.md › Rate limiting](./http.md#rate-limiting)). `per` is a number of seconds or a string such as `'30s'`, `'1m'`, `'1h'` or `'1d'`.
- **`throws`:** `.throws(...errors)` on an endpoint, and `throws: [...]` in the options of a contract or a scope ([Domain errors](#domain-errors)). Built-in catalog errors are accepted.
- **Opt-outs are endpoint methods:** `.public()`, `.throttle(false)` and `.authorize(false)`. A contract or a scope never removes a capability it inherits. A contract that must be public as a whole sits outside the authenticated scope.
- **`.authorize(false)`** skips every inherited `authorize` check for that endpoint, and its derived 403 goes away.
- **Error union:** an endpoint's error union is every derived error plus the union of its `throws` across all levels. Two errors can share a status (for example `FORBIDDEN` and an app-defined `EMAIL_NOT_VERIFIED` are both 403), so clients narrow by `code` ([client.md › Result union](./client.md#result-union)).
- **Runtime twin:** `resolveCapabilities` applies the same rules to `EndpointDef`s and the runtime scope chain. `apiRoutes()` exposes its result per route, with `errors` ordered derived first (422, 404, 401, 403, 429), then `throws` from the scopes (outer to inner), the contract and the endpoint, unique by code.
- **Browser-safe:** the capabilities are plain data in `@laratype/contract`. The package stays free of `node:*` imports.

### Diagnostics
`CapabilityProblem` messages, shown as `{ error: "<key>: <message>" }` by `defineContract` and thrown as `[@laratype/contract] <route name>: <message>` by `defineApi`:
- `.public() under a scope with authorize: add .authorize(false) or move the contract out of the scope`
- `.authorize() needs auth on the endpoint, its contract or a scope`
- `.authorize() needs auth, but the endpoint is .public()` (type-level only; at runtime it gets the previous message)

Type-only (`types/capabilities.types.ts`): an unknown guard, `authorize` or `auth: false` in contract options, `throttle: false` in scope options, and non-factory `throws`.

### Example
[`examples/contract/endpoint.ts`](./examples/contract/endpoint.ts) · [`examples/contract/contracts.ts`](./examples/contract/contracts.ts)

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
merged ([#228](https://github.com/Laratypes/Laratype/issues/228)): `defineError`, `ContractError` and `throws`. Throwing and mapping to responses is planned → [#108](https://github.com/Laratypes/Laratype/issues/108) (H5).

### Public API
[`packages/contract/src/errors.ts`](../../packages/contract/src/errors.ts)

```ts
export class ContractError<St extends number = number, Code extends string = string, Body = unknown> extends Error {
  readonly status: St;
  readonly code: Code;
  readonly body: Body;
  constructor(status: St, code: Code, body: Body);   // message: body.message when it is a string, else the code
}
export interface ErrorDef<St extends number = number, Code extends string = string, Body = unknown, Args extends unknown[] = any[]> {
  (...args: Args): ContractError<St, Code, Body>;   // throwable factory
  readonly status: St;
  readonly code: Code;
  is(error: unknown): error is ContractError<St, Code, Body>;   // compares code, not instanceof
}
export type AnyErrorDef = ErrorDef<number, string, any, any[]>;
export type ErrorStatus<E>;                           // per def, distributes over unions
export type ErrorCode<E>;
export type ErrorBody<E>;
export type ErrorResponse<E> = E extends ErrorDef<infer St, infer Code, infer Body, any> ? { status: St; code: Code; body: Body } : never;
export function defineError<const St extends number, const Code extends string>(status: St, code: Code): ErrorDef<St, Code, MessageBody, [message?: string]>;
export function defineError<const St extends number, const Code extends string, Args extends unknown[], Body>(
  status: St, code: Code, body: (...args: Args) => Body): ErrorDef<St, Code, Body, Args>;
```

```ts
// app/api/errors.ts, an FE-importable module
export const EmailTaken = defineError(409, 'EMAIL_TAKEN', (email: string) => ({ message: 'The email is taken.', email }))

// a service, at any depth: no propagation code
if (await this.emailExists(input.email)) throw EmailTaken(input.email)

// anywhere: match by code
if (EmailTaken.is(e)) e.body.email
```

### Invariants
- **A factory:** `defineError(status, code, body?)` returns a frozen function that also carries `status`, `code` and `is`. Calling it builds a `ContractError` (an `Error`) to throw. Without a body factory the body is `{ message }`, and the message defaults to the code.
- **`E.is(e)`** compares `code`, not `instanceof`, so it works across bundles and package copies.
- **Codes** are `UPPER_SNAKE` (`/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/`), like the built-in [catalog](#error-catalog).
- **Declaring:** `throws` on an endpoint, a contract or a scope. The levels add up ([inheritance](#capabilities-and-derived-errors)). `throws` also accepts the built-in catalog errors. For example, a search endpoint with no path param whose service throws `notFound` declares `.throws(errors.notFound)`, so the undeclared-error check accepts it.
- **403 from auth:** an unverified or locked account is a domain error, for example `defineError(403, 'EMAIL_NOT_VERIFIED')`. The guard throws it, and the contract or scope declares it with `throws`. There is no separate capability for it.
- **Undeclared errors:** in dev and test, throwing an error the running endpoint doesn't declare is reported, and fails the test ([http.md › Undeclared-error check](./http.md#undeclared-error-check)).
- **Status outside HTTP:** errors carry an HTTP status. Jobs and CLI code that reuse them ignore it.

### Diagnostics
Runtime `TypeError`s, prefixed `[@laratype/contract] `:
- `defineError: invalid status <status>` (not an integer)
- `defineError: code "<code>" must be UPPER_SNAKE`
- `defineError("<code>"): body must be a function`

Type-only (`types/errors.types.ts`): a string status, a missing code, a non-function body, and factory arguments of the wrong type.

### Example
[`examples/contract/endpoint.ts`](./examples/contract/endpoint.ts) (`EmailTaken`, `.is()`, narrowing by `code`)

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
