---
area: http
packages: ["@laratype/http"]
issues: [84, 104, 105, 106, 107, 108, 117, 118, 122, 123, 138, 139, 162, 163, 164, 184]
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
| [Policies on routes: .can()](#policies-on-routes-can) | planned → #122 |
| [Resources](#resources) | planned → #123 |
| [Interceptors](#interceptors) | planned → #138 |
| [Ad-hoc routes](#ad-hoc-routes) | planned → #139 |
| [Route names and URLs](#route-names-and-urls) | planned → #162 |
| [CORS](#cors) | planned → #164 |

---

## Controller typing: Ctx and ControllerOf

### Status
Decided: S1 [#84](https://github.com/Laratypes/Laratype/issues/84) chose option A. Code planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2). Neither type exists in `packages/` yet.

### Public API
Reference shape from the S1 spike ([`s1-controller/lib/ctx.ts` @ 4c558fd](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/s1-controller/lib/ctx.ts)). This is not package code, and H2 may refine the names of the helper types:

```ts
// abridged: spike reference, see the permalink
type Ctx<E extends AnyEndpoint, Requires extends object = {}>;   // BaseCtx<E> merged with Requires (params merged one level deep)
// BaseCtx<E> = { readonly endpoint: E; params: PathParams<path>; query: InferOut<query>; body: InferOut<body> }
type Result<E extends AnyEndpoint>;        // response schema INPUT (void if none) | ErrorReply of a DECLARED error
const fail: <D extends ErrorDef>(def: D, body: BodyOf<D>) => ErrorReply<D>;   // BodyOf<D> ≡ contract's ErrorBody<D>
type ControllerOf<C>;                       // { [endpoint key]: (ctx: any) => MaybePromise<Result<C[K]>> }
```

Usage (decided style):

```ts
export class UserController implements ControllerOf<typeof users> {   // optional
  constructor(private readonly repo: UserRepository) {}                // constructor DI, no decorator
  async index({ query }: Ctx<typeof users.index>) { return this.repo.list(query.page); }
  async show({ params }: Ctx<typeof users.show, { params: { user: User } }>) { return params.user; }
  async destroy({ params, user }: Ctx<typeof users.destroy, { params: { user: User }; user: User }>) {
    if (user.role !== "admin") return fail(errors.forbidden, { message: "…" });
  }
}
```

### Invariants
- Handlers are **class methods**, and each one annotates its first parameter `Ctx<typeof contract.endpoint, Requires>`. `implements` doesn't contextually type params (TS #23911), so the annotation is required.
- `Requires` is what the handler **needs from the route**: middleware extensions (for example `user`) and `.bind()`-resolved params.
- `ctx.query` and `ctx.body` use the schema **output**, because they hold validated values.
- **Return value:** a handler returns the response schema **input**, since the serializer runs afterwards. For an error it returns `fail(errorDef, body)`, but only for errors **declared** on the endpoint.
- `implements ControllerOf<typeof c>` is optional. With it, a wrong return shape or a missing handler is reported at the method. Without it, the error appears at `r.contract()`.
- The runtime always calls `instance[key](ctx)`, never a detached reference (option A methods lose `this`).
- Option B (`x = action(endpoint, handler)`) is **not** shipped in v1. The route check accepts any callable property, so B can be added later without changing H2.

### Diagnostics
See [Route proof at r.contract()](#route-proof-at-rcontract).

### Example
None compiled yet. The usage above is the S1 fixture `s1-controller/app/controllers/UserControllerA.ts`.

### Non-goals
- No decorators for routes, params or bodies.
- No contextual typing of handler params.

### Open questions
- `ctx.endpoint`: a runtime field (useful for interceptors and logging), or phantom only? → [#105](https://github.com/Laratypes/Laratype/issues/105)

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
// Provided<E, X, B> = Ctx<E, X & { params: BoundParams<E, B> }>
```

### Invariants
- **The controller declares, the route proves.** For each endpoint, the route computes `Provided = Ctx<E, MiddlewareExt & { params: Bound }>`. Here `MiddlewareExt` is the intersection of every middleware's extension in order, and `Bound` is the `.bind()` map restricted to that endpoint's path params.
- **Bound value types:** a class binder gives `InstanceType`. A resolver gives `NonNullable<Awaited<ReturnType>>`, because a miss is a 404.
- **Requirement check:** `[Provided] extends [Param]` (one-directional), where `Param` is the handler's first parameter. Function assignability is **not** used: methods compare bivariantly, so a naive check would accept a handler that needs `user` on a route without `auth()`.
- **Return check:** `[Awaited<R>] extends [Result<E>]`.
- **Also checked at `r.contract()`:**
  - exhaustiveness, so every endpoint needs a handler;
  - `.bind()` keys that are not a path param of any endpoint;
  - a handler typed for a different endpoint.
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
S1 fixture `s1-controller/app/routes.ts`:
```ts
r.middleware(auth()).bind({ user: User }).contract(users, UserController);
```

### Non-goals
- No runtime re-check of what the types already prove.

### Open questions
- Per-endpoint middleware inside one contract (for example `auth()` only on `destroy`) → [#105](https://github.com/Laratypes/Laratype/issues/105), [#117](https://github.com/Laratypes/Laratype/issues/117)
- Optional path params with `.bind()` (`Model | undefined`?) → [#118](https://github.com/Laratypes/Laratype/issues/118)
- Type performance of `VerifyController` with 50+ endpoints → [#95](https://github.com/Laratypes/Laratype/issues/95) (S6)

### Acceptance
[#105 Done when](https://github.com/Laratypes/Laratype/issues/105)

---

## Router v2

### Status
planned → [#104](https://github.com/Laratypes/Laratype/issues/104) (H1).

### Design (non-binding)
- **Builder:** `Route.prefix("/api").middleware(...).group((r) => [...])`.
- **Registration:** `r.contract(contract, Controller)` registers every endpoint of the contract on Hono. The design keeps Laravel-style route files (`app/routes/api.ts`).
- **Registry:** each route registry entry holds the name (`users.show`), method, path, endpoint def, controller and middleware. `sauf route:list` reads it, and so will OpenAPI ([#143](https://github.com/Laratypes/Laratype/issues/143)) and Detective ([#144](https://github.com/Laratypes/Laratype/issues/144)).
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
- **Kernel container:** the kernel container needs `{ deps: depsRegistry }` ([#102 comment](https://github.com/Laratypes/Laratype/issues/102#issuecomment-6084336635)).
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
global middleware → route middleware → guard/policy (.can) → FormRequest.authorize
→ validation (422) → interceptor (before) → handler → interceptor (after)
→ serialize (Resource / response schema) → exception filter
```

- **Parsing and validation (H3):** see [validation.md › Pipeline validation and 422](./validation.md#pipeline-validation-and-422). The pipeline builds the typed handler context.
- **Replaces:** `RequestKernel.pipeline` and `processValidation`.
- **Pre-existing test failure:** an `@laratype/http` Request test fails on master today (`ControllerMock.__invoke`) → [#184](https://github.com/Laratypes/Laratype/issues/184) (H16).

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
- Wire type of the response (`Date` → `string`) → [#107](https://github.com/Laratypes/Laratype/issues/107), [#110](https://github.com/Laratypes/Laratype/issues/110)

### Acceptance
[#107 Done when](https://github.com/Laratypes/Laratype/issues/107)

---

## Exceptions

### Status
planned → [#108](https://github.com/Laratypes/Laratype/issues/108) (H5).

### Design (non-binding)
- **`HttpException`:** built from an `ErrorDef` ([contract.md › Error catalog](./contract.md#error-catalog)) and mapped to the contract's error response `{ status, body }`.
- **Unknown errors:** a 500 that doesn't leak details.
- **Replaces:** `Response.resolveException`.
- **Strict mode:** a dev `--strict-contract` mode checks that a thrown error is declared in `.errors()` → [#157](https://github.com/Laratypes/Laratype/issues/157) (X3).
- **Done when:** runtime tests for the 404, 403, 422 and 500 bodies.

### Acceptance
[#108 Done when](https://github.com/Laratypes/Laratype/issues/108)

---

## Typed middleware

### Status
planned → [#117](https://github.com/Laratypes/Laratype/issues/117) (H6).

### Design (non-binding)
- **Definition:** `defineMiddleware<Ext>((ctx, next) => next(ext))` declares the context keys it adds (#117). An example is `auth()` adding `{ user: User }`; the S1 spike has the same shape in `router.ts`.
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
- **Implicit binding (H14):**
  - Path params that match a key in `Register['models']` bind automatically. The manifest generates that map, keyed by the camelCase model name.
  - An explicit `.bind()` takes precedence, and `.withoutImplicitBinding()` opts out.
  - `static routeKeyName` sets the lookup column (the default is the primary key).
  - `.scopeBindings()` handles nested params.
  - Removes `globalThis.__laratype_param_model_map`.

### Acceptance
[#118 Done when](https://github.com/Laratypes/Laratype/issues/118) · [#163 Done when](https://github.com/Laratypes/Laratype/issues/163)

---

## Policies on routes: .can()

### Status
planned → [#122](https://github.com/Laratypes/Laratype/issues/122) (H8). Depends on typed policies, A3 [#121](https://github.com/Laratypes/Laratype/issues/121).

### Design (non-binding)
`.can({ show: ['view', 'user'] })`: the ability comes from `keyof Policy`, and the model arguments come from the bound params (#122). This replaces the free-form string arguments of 0.5 `can('view', 'user')` (`RoutePolicy.make`). A denial is a runtime 403.

### Acceptance
[#122 Done when](https://github.com/Laratypes/Laratype/issues/122)

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
`r.get('/health', () => 'ok')` without a contract keeps the Laravel feel. Types are inferred, but the route has no schema and is **excluded from OpenAPI**.

### Acceptance
[#139 Done when](https://github.com/Laratypes/Laratype/issues/139)

---

## Route names and URLs

### Status
planned → [#162](https://github.com/Laratypes/Laratype/issues/162) (H13, M3).

### Design (non-binding)
- **URL helpers:** a typed `route('users.show', { user })` and `redirect().route(name, params)`. Names come from `defineApi`, and params are typed from the path.
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
