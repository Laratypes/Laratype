---
area: http
packages: ["@laratype/http"]
issues: [84, 104, 105, 106, 107, 108, 117, 118, 121, 122, 123, 138, 139, 157, 162, 163, 164, 184, 229]
verified-against: Laratype@d70daa7 (+ spike PR #197 @ 4c558fd)
last-verified: 2026-10-09
---

# HTTP (`@laratype/http`)

The v1 HTTP layer binds contracts to controllers on a Hono router. It runs a typed pipeline (middleware, binding, policies, validation, interceptors) and turns handler results and exceptions into the responses the contract declares.

**No v1 HTTP code exists yet.** `@laratype/http` on master is the 0.5 package. Its route tree is built by `_createNestedRoute` in `packages/http/src/routing/Route.ts`, controllers are created with `new` in `Request.controllerKernel` (`packages/http/src/request/Request.ts`), and the status is guessed from the method name (`ControllerMethodHttpStatusCode`). Everything below is either **decided** (S1) or **planned**. Signatures quoted from the S1 spike (`spikes/v1/s1-controller/lib/*` on PR #197 @ 4c558fd) are the decided *shape* but are not package code. H2 [#105](https://github.com/Laratypes/Laratype/issues/105) owns the real signatures.

Decision record: S1 [#84](https://github.com/Laratypes/Laratype/issues/84), [DECISIONS-S1-S2.md §S1](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s1-84-decision).

| Section | Status |
|---|---|
| [Controller typing: Ctx and ControllerOf](#controller-typing-ctx-and-controllerof) | decided (S1 #84); code planned → #105 |
| [Route proof at r.contract()](#route-proof-at-rcontract) | decided (S1 #84); code planned → #105 |
| [Router v2](#router-v2) | planned → #104 |
| [Controller resolution](#controller-resolution) | planned → #105 |
| [Request pipeline](#request-pipeline) | planned → #106, #138 |
| [Response from the contract](#response-from-the-contract) | planned → #107 |
| [Exceptions](#exceptions) | planned → #108 |
| [Typed middleware](#typed-middleware) | planned → #117 |
| [Model binding](#model-binding) | planned → #118, #163 |
| [Policies on routes: .can()](#policies-on-routes-can) | planned → #122; superseded by planned → #105, #121 |
| [Authorization from the contract](#authorization-from-the-contract) | planned → #105, #121, #104 |
| [Rate limiting](#rate-limiting) | planned → #229 |
| [Resources](#resources) | planned → #123 |
| [Interceptors](#interceptors) | planned → #138 |
| [Ad-hoc routes](#ad-hoc-routes) | planned → #139 |
| [Route names and URLs](#route-names-and-urls) | planned → #162 |
| [CORS](#cors) | planned → #164 |
| [Undeclared-error check](#undeclared-error-check) | planned → #157 |

---

## Controller typing: Ctx and ControllerOf

### Status
Decided: S1 [#84](https://github.com/Laratypes/Laratype/issues/84) chose option A. Code planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2). Neither type exists in `packages/` yet. The spike's `fail()`, `ErrorReply` and the error branch of `Result<E>` are removed: errors are thrown, and framework errors come from the contract's capabilities (planned → [#108](https://github.com/Laratypes/Laratype/issues/108)).

### Public API
Reference shape from the S1 spike ([`s1-controller/lib/ctx.ts` @ 4c558fd](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/s1-controller/lib/ctx.ts)). This is not package code, and H2 may refine the names of the helper types:

```ts
// abridged: spike reference, see the permalink; fail() and ErrorReply are removed (see Status)
type Ctx<E extends AnyEndpoint, Requires extends object = {}>;   // BaseCtx<E> merged with Requires (params merged one level deep)
// BaseCtx<E> = { readonly endpoint: E; params: PathParams<path>; query: InferOut<query>; body: InferOut<body> }
type Result<E extends AnyEndpoint>;        // response schema INPUT (void if none)
type ControllerOf<C>;                       // { [endpoint key]: (ctx: any) => MaybePromise<Result<C[K]>> }
```

Usage (decided style):

```ts
export class UserController implements ControllerOf<typeof users> {   // optional
  constructor(private readonly repo: UserRepository) {}                // constructor DI, no decorator
  async index({ query }: Ctx<typeof users.index>) { return this.repo.list(query.page); }
  async show({ params }: Ctx<typeof users.show, { params: { user: User } }>) { return params.user; }
  async destroy({ params }: Ctx<typeof users.destroy, { params: { user: User } }>) {
    await this.repo.delete(params.user);                               // 403 comes from .authorize() and its policy
  }
}
```

### Invariants
- Handlers are **class methods**, and each one annotates its first parameter `Ctx<typeof contract.endpoint, Requires>`. `implements` doesn't contextually type params (TS #23911), so the annotation is required.
- `Requires` is what the handler **needs from the route**: middleware extensions and `.bind()`-resolved params.
- `ctx.user` comes from the endpoint's `auth` capability and is typed per guard, so a handler doesn't list it in `Requires` ([auth.md › Authentication from the contract](./auth.md#authentication-from-the-contract), [#120](https://github.com/Laratypes/Laratype/issues/120)).
- `ctx.query` and `ctx.body` use the schema **output**, because they hold validated values.
- `ctx.endpoint` is a read-only runtime field that holds the endpoint, so interceptors ([#138](https://github.com/Laratypes/Laratype/issues/138)) and X3 [#157](https://github.com/Laratypes/Laratype/issues/157) can read it ([#105](https://github.com/Laratypes/Laratype/issues/105)).
- **Return value:** a handler returns the response schema **input**, since the serializer runs afterwards.
- **Errors are thrown,** at any depth. A domain error is declared with `throws` ([contract.md › Domain errors](./contract.md#domain-errors)). Framework errors (401, 403, 404, 422, 429) come from the contract's capabilities and need no handler code.
- `implements ControllerOf<typeof c>` is optional. With it, a wrong return shape or a missing handler is reported at the method. Without it, the error appears at `r.contract()`.
- The runtime always calls `instance[key](ctx)`, never a detached reference (option A methods lose `this`).
- Option B (`x = action(endpoint, handler)`) is **not** shipped in v1. The route check accepts any callable property, so B can be added later without changing H2.

### Diagnostics
See [Route proof at r.contract()](#route-proof-at-rcontract).

### Example
None compiled yet. The usage above is the S1 fixture `s1-controller/app/controllers/UserControllerA.ts`, with its `fail()` branch removed.

### Non-goals
- No decorators for routes, params or bodies.
- No contextual typing of handler params.

### Open questions
- Resolved: `ctx.endpoint` is a read-only runtime field ([#105](https://github.com/Laratypes/Laratype/issues/105)).

### Acceptance
[#84](https://github.com/Laratypes/Laratype/issues/84) (decision) · [#105 Done when](https://github.com/Laratypes/Laratype/issues/105)

---

## Route proof at r.contract()

### Status
Decided: S1 [#84](https://github.com/Laratypes/Laratype/issues/84). Code planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2), [#117](https://github.com/Laratypes/Laratype/issues/117) (H6), [#118](https://github.com/Laratypes/Laratype/issues/118) (H7).

### Public API
Reference shape from the spike ([`s1-controller/lib/router.ts` @ 4c558fd](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/s1-controller/lib/router.ts)):

```ts
// abridged: spike reference, see the permalink
interface RouteBuilder<X extends object = {}, B extends Record<string, Binder> = {}> {
  middleware<const M extends readonly Middleware<any>[]>(...m: M): RouteBuilder<X & ExtOf<M>, B>;
  bind<const NB extends Record<string, Binder>>(bindings: NB): RouteBuilder<X, B & NB>;
  contract<C extends Contract, K extends ControllerClass>(contract: C, controller: K & VerifyController<C, InstanceType<K>, X, B>): void;
}
// planned (E10, #105): contract(contract, controller, { policy?, endpoints? })
// Provided<E, X, B> = Ctx<E, X & { params: BoundParams<E, B> }>
```

### Invariants
- **The controller declares, the route proves.** For each endpoint, the route computes `Provided = Ctx<E, MiddlewareExt & { params: Bound }>`. Here `MiddlewareExt` is the intersection of every middleware's extension in order, and `Bound` is the `.bind()` map restricted to that endpoint's path params.
- **Bound value types:** a class binder gives `InstanceType`. A resolver gives `NonNullable<Awaited<ReturnType>>`, because a miss is a 404.
- **Requirement check:** `[Provided] extends [Param]` (one-directional), where `Param` is the handler's first parameter. Function assignability is **not** used: methods compare bivariantly, so a naive check would accept a handler that needs a middleware extension the route doesn't provide.
- **Return check:** `[Awaited<R>] extends [Result<E>]`.
- **Also checked at `r.contract()`:**
  - exhaustiveness, so every endpoint needs a handler;
  - `.bind()` keys that are not a path param of any endpoint;
  - a handler typed for a different endpoint.
- **Options (planned → [#105](https://github.com/Laratypes/Laratype/issues/105)):** `r.contract(c, Ctrl, { policy, endpoints: {...} })`.
  - `policy` covers the endpoints with `authorize` ([Authorization from the contract](#authorization-from-the-contract)).
  - `endpoints` holds per-endpoint middleware as callbacks keyed by endpoint name, for example `{ destroy: (r) => r.middleware(audit()) }`. Their extensions count for that endpoint only. Endpoint names can't collide with option keys.
- **Return check, errors:** errors are thrown, so the return check covers the response schema only.
- **Readable errors:** when the controller is valid, the controller parameter's type is `K & unknown`. Otherwise it is an object type whose **property names are the diagnosis**, because tsc prints missing property names in full but truncates property types.

### Diagnostics
Message templates from the S1 spike (real tsc 5.9.2 output in `s1-controller/tsc-errors.txt` @ 4c558fd). `<c>.<e>` is the route name:
- `` <c>.<e>: handler requires `<key>`, route does not provide it (add middleware / .bind()) ``, with `{ handler_requires: T }`
- `` <c>.<e>: `<key>` provided by the route does not match the handler (missing .bind()?) ``, with `{ route_provides; handler_requires }`
- `<c>.<e>: handler ctx is typed for a different endpoint`
- `<c>.<e>: return type does not match the response schema / declared errors`
- `<c>.<e>: controller has no handler for this endpoint`
- `` .bind(): `<key>` is not a path param of any endpoint in <contract> ``

Here `<key>` may be nested, for example `params.user`. H2 must keep the "endpoint name + key" information in its messages (#84 Done-when (c)).

### Example
Planned shape (E3, E10; illustrative, no compiled example yet):
```ts
Route.api(appApi, (r) => [
  r.bind({ user: User }).scope('users/[user]', { policy: UserScopePolicy }),
  r.contract(posts, PostController, { policy: PostPolicy, endpoints: { destroy: (r) => r.middleware(audit()) } }),
])
```

### Non-goals
- No runtime re-check of what the types already prove.

### Open questions
- Resolved: middleware for a single endpoint of a contract goes in a callback map keyed by endpoint name, under `endpoints` in the options of `r.contract()` ([#105](https://github.com/Laratypes/Laratype/issues/105), [#117](https://github.com/Laratypes/Laratype/issues/117)).
- Resolved: an optional path param with `.bind()` is typed `Model | undefined`. An absent param gives `undefined`; a present param with no match gives 404 ([#118](https://github.com/Laratypes/Laratype/issues/118)).
- Type performance of `VerifyController` with 50+ endpoints → [#95](https://github.com/Laratypes/Laratype/issues/95) (S6)

### Acceptance
[#105 Done when](https://github.com/Laratypes/Laratype/issues/105)

---

## Router v2

### Status
planned → [#104](https://github.com/Laratypes/Laratype/issues/104) (H1).

### Design (non-binding)
- **Builder:** `Route.api(appApi, (r) => [...])` mounts the contracts. Every contract is mounted exactly once; a missing or duplicate contract is a compile error.
- **URLs:** contract routes take their URL from the contract's place in the [folder tree](./contract.md#contract-folder-tree), so they have no route prefix. Ad-hoc routes keep `Route.prefix(...)` and `group(...)` ([Ad-hoc routes](#ad-hoc-routes)).
- **Registration:** `r.contract(contract, Controller, { policy, endpoints })` registers every endpoint of the contract on Hono ([Route proof](#route-proof-at-rcontract)). The design keeps Laravel-style route files (`app/routes/api.ts`).
- **Scopes:** `r.scope('<folder>', { policy })` mounts the policy for a `_scope.ts` ([Authorization from the contract](#authorization-from-the-contract)), and `r.bind({...}).scope(...)` binds once for every contract under it ([Model binding](#model-binding)).
- **Domain:** set on `Route.api(...).domain(...)`.
- **Discovery:** the server scans the contract tree at dev startup. Production reads the manifest written by the build ([build.md › Plugin chain](./build.md#plugin-chain)).
- **Registry:** each route registry entry holds the name (`users.posts.update`), method, path, endpoint def, controller and middleware. `sauf route:list` reads it, and so will OpenAPI ([#143](https://github.com/Laratypes/Laratype/issues/143)) and Detective ([#144](https://github.com/Laratypes/Laratype/issues/144)).
- **Replaces:** `_createNestedRoute` and the 0.5 `RouteOptions` object tree.
- **Registry storage:** the registry moves from `globalThis.__laratype_routes` into the container (`RouteRegistry`, [#114](https://github.com/Laratypes/Laratype/issues/114)).

### Acceptance
[#104 Done when](https://github.com/Laratypes/Laratype/issues/104)

---

## Controller resolution

### Status
planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2).

### Design (non-binding)
- **Resolution:** controllers are resolved with the container (`app.make(Controller)`) instead of `new`. That gives constructor DI through the [DI transform](./di.md#di-transform) and the container's scopes.
- **Scope bubbling:** a controller that depends on a request-scoped provider becomes request-scoped ([#112](https://github.com/Laratypes/Laratype/issues/112)).
- **Kernel container:** the kernel container already passes `{ deps: depsRegistry }`, merged ([#102](https://github.com/Laratypes/Laratype/issues/102)).
- **Done when:** runtime tests with constructor DI.

### Acceptance
[#105 Done when](https://github.com/Laratypes/Laratype/issues/105)

---

## Request pipeline

### Status
planned → [#106](https://github.com/Laratypes/Laratype/issues/106) (H3), [#138](https://github.com/Laratypes/Laratype/issues/138) (H11).

### Design (non-binding)
Fixed order, combining Nest and Laravel:

```
global middleware → auth guard (contract auth, 401) → throttle (429) → route middleware
→ model binding (404) → policies (authorize, 403: scopes outer → inner, then the endpoint)
→ validation (422) → interceptor (before) → handler → interceptor (after)
→ serialize (Resource / response schema) → exception filter
```

- **From the contract:** the auth guard, the rate limit and the policies are applied from the contract's capabilities, so API routes need no auth or throttle middleware ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)).
- **Parsing and validation (H3):** see [validation.md › Pipeline validation and 422](./validation.md#pipeline-validation-and-422). The pipeline builds the typed handler context.
- **Replaces:** `RequestKernel.pipeline` and `processValidation`.

### Acceptance
[#106 Done when](https://github.com/Laratypes/Laratype/issues/106) · [#138 Done when](https://github.com/Laratypes/Laratype/issues/138)

---

## Response from the contract

### Status
planned → [#107](https://github.com/Laratypes/Laratype/issues/107) (H4).

### Design (non-binding)
- **Status:** taken from `.response(schema, status)`. The default is `200`, and it is `204` when there is no response schema.
- **Body:** JSON serialization, with optional dev-mode output validation.
- **Replaces:** the method-name guess in `ControllerMethodHttpStatusCode`.
- **Done when:** runtime tests for 200, 201 and 204.

### Open questions
- Resolved: the frontend sees the response as `Jsonify<output>` (`Date` → `string`) ([#107](https://github.com/Laratypes/Laratype/issues/107), [#110](https://github.com/Laratypes/Laratype/issues/110)).

### Acceptance
[#107 Done when](https://github.com/Laratypes/Laratype/issues/107)

---

## Exceptions

### Status
planned → [#108](https://github.com/Laratypes/Laratype/issues/108) (H5).

### Design (non-binding)
- **Domain errors:** a thrown `defineError` instance becomes its own status, code and body ([contract.md › Domain errors](./contract.md#domain-errors)).
- **Framework errors:** 401, 403, 404, 422 and 429 use the built-in catalog.
- **Removed:** `fail()`, `ErrorReply` and the error branch of `Result<E>` ([Controller typing](#controller-typing-ctx-and-controllerof)).
- **Unknown errors:** a 500 with the body `{ message: "Server Error" }` (`MessageBody`), with no details ([#108](https://github.com/Laratypes/Laratype/issues/108)). A dev-mode detail view is out of scope for M1.
- **Replaces:** `Response.resolveException`.
- **Undeclared errors:** checked in dev and test → [Undeclared-error check](#undeclared-error-check) (X3 [#157](https://github.com/Laratypes/Laratype/issues/157)).
- **Done when:** runtime tests for the 404, 403, 422 and 500 bodies.

### Acceptance
[#108 Done when](https://github.com/Laratypes/Laratype/issues/108)

---

## Typed middleware

### Status
planned → [#117](https://github.com/Laratypes/Laratype/issues/117) (H6).

### Design (non-binding)
- **Definition:** `defineMiddleware<Ext>((ctx, next) => next(ext))` declares the context keys it adds (#117). The S1 spike has the same shape in `router.ts`.
- **Not for API auth:** authentication and rate limits come from the contract's `auth` and `throttle` ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)). Examples use other middleware, such as `audit()`.
- **Per endpoint:** middleware for one endpoint goes in `r.contract(c, Ctrl, { endpoints: {...} })` ([Route proof](#route-proof-at-rcontract)).
- **Accumulation:** the route builder accumulates `Ext` across global, group and route middleware, so the handler sees the combined context. A missing middleware is reported at `r.contract()` (see [Route proof](#route-proof-at-rcontract)).
- **Opt-out:** `withoutMiddleware`.
- **Port:** replaces `packages/http/src/middleware/Middleware.ts`.

### Acceptance
[#117 Done when](https://github.com/Laratypes/Laratype/issues/117)

---

## Model binding

### Status
planned → [#118](https://github.com/Laratypes/Laratype/issues/118) (H7, explicit), [#163](https://github.com/Laratypes/Laratype/issues/163) (H14, implicit). Both wait for the ORM decision, S5 [#88](https://github.com/Laratypes/Laratype/issues/88) (`BindableModel`).

### Design (non-binding)
- **Explicit binding (H7):** `.bind({ user: User })`, with keys restricted to path params, or a custom resolver `.bind({ user: (v) => ... })`.
  - A miss is a 404.
  - The binding contributes `{ params: { user: User } }` to the provided context.
  - Replaces `Route.model` / `Route.bind` and `explicitModelBinding`.
  - Keys are checked against every path param of the contract, including the params of parent `[x]` folders ([contract.md › Contract folder tree](./contract.md#contract-folder-tree)).
  - `r.bind({...}).scope('<folder>', ...)` binds once for every contract under that scope. Each bound model is resolved once per request.
- **Implicit binding (H14):**
  - Path params that match a key in `Register['models']` bind automatically. The manifest generates that map, keyed by the camelCase model name.
  - An explicit `.bind()` takes precedence, and `.withoutImplicitBinding()` opts out.
  - `static routeKeyName` sets the lookup column (the default is the primary key).
  - `.scopeBindings()` handles nested params.
  - Implicit binding and `.scopeBindings()` use the same folder params as `.bind()`.
  - Removes `globalThis.__laratype_param_model_map`.

### Acceptance
[#118 Done when](https://github.com/Laratypes/Laratype/issues/118) · [#163 Done when](https://github.com/Laratypes/Laratype/issues/163)

---

## Policies on routes: .can()

### Status
planned → [#122](https://github.com/Laratypes/Laratype/issues/122) (H8). Superseded by planned → [#105](https://github.com/Laratypes/Laratype/issues/105), [#121](https://github.com/Laratypes/Laratype/issues/121): the route-level `.can({...})` is replaced by the `authorize` capability and `{ policy }` ([Authorization from the contract](#authorization-from-the-contract)).

### Design (non-binding)
The earlier design: `.can({ show: ['view', 'user'] })`: the ability comes from `keyof Policy`, and the model arguments come from the bound params (#122). This replaces the free-form string arguments of 0.5 `can('view', 'user')` (`RoutePolicy.make`). A denial is a runtime 403.

### Acceptance
[#122 Done when](https://github.com/Laratypes/Laratype/issues/122)

---

## Authorization from the contract

### Status
planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2, compile check and order), [#121](https://github.com/Laratypes/Laratype/issues/121) (A3, policies), [#104](https://github.com/Laratypes/Laratype/issues/104) (H1, `r.scope()`).

### Design (non-binding)
- **Declared in the contract:** `authorize: true` on a [folder scope](./contract.md#folder-scopes) or `.authorize()` on an endpoint adds a 403 ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)).
- **Mounted on the server:** `r.scope('<folder>', { policy })` for a scope, and `r.contract(c, Ctrl, { policy })` for endpoints.
- **Compile check:**
  - every endpoint with `.authorize()` needs a policy that has a method for that endpoint (named after the endpoint key), or a `before` hook;
  - a scope with `authorize` and no mounted policy is a compile error in `Route.api`, with a runtime check too;
  - `authorize` without `auth` at the same or an outer level, including `.public()` under a scope with `authorize`, is a compile error ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)).
- **Order:** scope policies run once per request, outer to inner, then the endpoint's policy. Bound models are resolved once and reused.
- **Scope hook:** a scope policy's `before(user, params)` receives the signed-in user and the scope's bound params (the resolved models).
- **`Gate.policy`:** `Gate.policy(Model, Policy)` stays for imperative checks such as `user.can('update', post)` in services ([auth.md › Policies and gates](./auth.md#policies-and-gates)).
- **Replaces:** the route-level `.can()` ([Policies on routes](#policies-on-routes-can)) and `FormRequest.authorize()` ([validation.md › FormRequest v2](./validation.md#formrequest-v2)).

### Open questions
- The arguments of an endpoint's policy method → [#121](https://github.com/Laratypes/Laratype/issues/121)

### Acceptance
[#105 Done when](https://github.com/Laratypes/Laratype/issues/105) · [#121 Done when](https://github.com/Laratypes/Laratype/issues/121)

---

## Rate limiting

### Status
planned → [#229](https://github.com/Laratypes/Laratype/issues/229) (H17, M2). Depends on C4b [#228](https://github.com/Laratypes/Laratype/issues/228), H1 [#104](https://github.com/Laratypes/Laratype/issues/104).

### Design (non-binding)
- **Declared in the contract:** `.throttle({ limit, per })` on a scope, a contract or an endpoint. The nearest level wins, and `.throttle(false)` opts out ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)).
- **Applied when routes are registered,** with no route middleware.
- **Key:** the user id, or the IP when no user is signed in.
- **Response:** 429 with the contract's error body, plus `Retry-After`.
- **Store:** counters go through the cache ([#166](https://github.com/Laratypes/Laratype/issues/166)), with a memory fallback.

### Non-goals
- No stacked limits on one endpoint.

### Acceptance
[#229 Done when](https://github.com/Laratypes/Laratype/issues/229)

---

## Resources

### Status
planned → [#123](https://github.com/Laratypes/Laratype/issues/123) (H9).

### Design (non-binding)
- **Definition:** `defineResource(Model, fn)` with an inferred output type, plus `.make`, `.collection`, `.paginate` and `when()` (#123).
- **Contract check:** the output is checked against the contract's response schema. The contract is the source of truth, so a resource must satisfy the contract.
- **Replaces:** `JsonResource.toJson(): any`.

### Acceptance
[#123 Done when](https://github.com/Laratypes/Laratype/issues/123)

---

## Interceptors

### Status
planned → [#138](https://github.com/Laratypes/Laratype/issues/138) (H11, M3).

### Design (non-binding)
Nest-style hooks before and after the handler, for transform, cache and logging. An interceptor may change the handler's result, but the contract response stays the final type the FE sees.

### Acceptance
[#138 Done when](https://github.com/Laratypes/Laratype/issues/138)

---

## Ad-hoc routes

### Status
planned → [#139](https://github.com/Laratypes/Laratype/issues/139) (H12, M3).

### Design (non-binding)
`r.get('/health', () => 'ok')` without a contract keeps the Laravel feel. Types are inferred, but the route has no schema and is **excluded from OpenAPI**. Ad-hoc routes keep `Route.prefix(...)`, `group(...)` and explicit names (`.name()`), unlike contract routes.

### Acceptance
[#139 Done when](https://github.com/Laratypes/Laratype/issues/139)

---

## Route names and URLs

### Status
planned → [#162](https://github.com/Laratypes/Laratype/issues/162) (H13, M3).

### Design (non-binding)
- **URL helpers:** a typed `route('users.posts.update', { user, post })` and `redirect().route(name, params)`. Names come from the folder tree plus the endpoint key ([contract.md › Contract folder tree](./contract.md#contract-folder-tree)). Params are typed from the path, including parent `[x]` folders.
- **Bound params:** they accept a Model, which contributes its route key.
- **Ad-hoc routes:** `.name()` names them.
- **Absolute URLs:** built from `config('app.url')`.
- **Shared builder:** the pure builder lives in `@laratype/contract` (see [contract.md › URL builder](./contract.md#url-builder)).

### Acceptance
[#162 Done when](https://github.com/Laratypes/Laratype/issues/162)

---

## CORS

### Status
planned → [#164](https://github.com/Laratypes/Laratype/issues/164) (H15, M3).

### Design (non-binding)
- **Middleware:** `cors()` wraps `hono/cors` and is registered as global middleware by default. It handles preflight for contract routes.
- **Config:** a typed `config/cors.ts` (paths, origins, methods, headers, exposed headers, max age, credentials).

### Acceptance
[#164 Done when](https://github.com/Laratypes/Laratype/issues/164)

---

## Undeclared-error check

### Status
planned → [#157](https://github.com/Laratypes/Laratype/issues/157) (X3, M4). Depends on H5 #108. It replaces the earlier `--strict-contract` dev mode.

### Design (non-binding)
- **Dev and test:** throwing an error that the running endpoint doesn't declare (its `throws` across all levels) is reported loudly, with the stack. In tests it fails the test. The check is a set lookup and is always on in dev and test ([cli.md › sauf dev](./cli.md#sauf-dev)).
- **Coverage report:** `sauf test` lists declared errors that no test triggers, which points at a missing test or a stale declaration.
- **Production:** the real status is still sent, and the FE gets `unexpected` ([client.md › Result union](./client.md#result-union)).
- **Response output:** checking the handler's output against the response schema belongs to [Response from the contract](#response-from-the-contract).

### Open questions
- Resolved: undeclared errors are reported in dev and fail the test in tests, with no warn-or-fail switch ([#157](https://github.com/Laratypes/Laratype/issues/157)).

### Acceptance
[#157 Done when](https://github.com/Laratypes/Laratype/issues/157)
