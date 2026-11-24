---
area: http
packages: ["@laratype/http"]
issues: [84, 104, 105, 106, 107, 108, 112, 117, 118, 121, 122, 123, 138, 139, 157, 162, 163, 164, 184, 229, 269, 288, 299, 336, 341, 342]
verified-against: Laratype@d70daa7 (+ spike PR #197 @ 4c558fd)
last-verified: 2026-10-09
---

# HTTP (`@laratype/http`)

The v1 HTTP layer binds contracts to controllers on a Hono router. It runs a typed pipeline (middleware, binding, policies, validation, interceptors) and turns handler results and exceptions into the responses the contract declares.

**Router v2 ([#104](https://github.com/Laratypes/Laratype/issues/104)) and controller resolution (H2a [#105](https://github.com/Laratypes/Laratype/issues/105)) are the only v1 HTTP code so far.** The rest of `@laratype/http` on master is the 0.5 package. Its route tree is built by `_createNestedRoute` in `packages/http/src/routing/Route.ts`, controllers are resolved with `Request.container().make()` in `Request.controllerKernel` (`packages/http/src/request/Request.ts`), and a 0.5 route's status is guessed from the method name (`ControllerMethodHttpStatusCode`); a `Route.api` route's comes from its endpoint ([Response from the contract](#response-from-the-contract)). Everything below is either **decided** (S1) or **planned**. Signatures quoted from the S1 spike (`spikes/v1/s1-controller/lib/*` on PR #197 @ 4c558fd) are the decided *shape* but are not package code. H2 [#105](https://github.com/Laratypes/Laratype/issues/105) owns the real signatures.

Decision record: S1 [#84](https://github.com/Laratypes/Laratype/issues/84), [DECISIONS-S1-S2.md §S1](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s1-84-decision).

| Section | Status |
|---|---|
| [Controller typing: Ctx and ControllerOf](#controller-typing-ctx-and-controllerof) | merged (#105, H2a + H2b); `BaseCtx` proposed: PR [#301](https://github.com/Laratypes/Laratype/pull/301) @ 4ea9155 |
| [Route proof at r.contract()](#route-proof-at-rcontract) | merged (#105, H2b); middleware extensions merged @ 112ec823 (H6, PR [#352](https://github.com/Laratypes/Laratype/pull/352)); bindings proposed (H7, PR [#379](https://github.com/Laratypes/Laratype/pull/379) @ 1578b639) |
| [Router v2](#router-v2) | merged ([#104](https://github.com/Laratypes/Laratype/issues/104)); prod tree source merged ([#125](https://github.com/Laratypes/Laratype/issues/125)); tree read by brand and `{ scope, dir }` entries proposed: PR [#310](https://github.com/Laratypes/Laratype/pull/310) @ cb9a5fe; registry storage merged @ 714b11ba (PR [#362](https://github.com/Laratypes/Laratype/pull/362), #114 D7) |
| [Controller resolution](#controller-resolution) | merged ([#105](https://github.com/Laratypes/Laratype/issues/105), H2a); request scope proposed: PR [#327](https://github.com/Laratypes/Laratype/pull/327) @ 3b2d2fe (D6 [#112](https://github.com/Laratypes/Laratype/issues/112)); fallback warning and core hint proposed: PR [#294](https://github.com/Laratypes/Laratype/pull/294) @ 40faad5 |
| [Middleware and policy resolution](#middleware-and-policy-resolution) | proposed: PR [#351](https://github.com/Laratypes/Laratype/pull/351) @ 9e9f4c4 (H21 [#269](https://github.com/Laratypes/Laratype/issues/269)) |
| [Request pipeline](#request-pipeline) | parsing and validation proposed: PR [#345](https://github.com/Laratypes/Laratype/pull/345) @ e54cb4d; B30 [#410](https://github.com/Laratypes/Laratype/issues/410) re-read the body cache, form conversion and form classifier, and refused a multi-valued `Content-Type` and a form media type name outside the leading media type, at [4109aef3](https://github.com/Laratypes/Laratype/commit/4109aef3); interceptors merged @ 23ef6862 (PR [#415](https://github.com/Laratypes/Laratype/pull/415), H11 [#138](https://github.com/Laratypes/Laratype/issues/138)) |
| [Default body limit](#default-body-limit) | proposed: PR [#381](https://github.com/Laratypes/Laratype/pull/381) @ [554d82f](https://github.com/Laratypes/Laratype/commit/554d82f) (H44 [#341](https://github.com/Laratypes/Laratype/issues/341)); B30 [#410](https://github.com/Laratypes/Laratype/issues/410) took the form cap from the form classifier and refused a multi-valued `Content-Type` and a form media type name outside the leading media type before it at [4109aef3](https://github.com/Laratypes/Laratype/commit/4109aef3) |
| [Response from the contract](#response-from-the-contract) | proposed: PR [#404](https://github.com/Laratypes/Laratype/pull/404) @ 23875e4e (H4 [#107](https://github.com/Laratypes/Laratype/issues/107), H32 [#312](https://github.com/Laratypes/Laratype/issues/312)) |
| [The 0.5 response](#the-05-response) | proposed: PR [#404](https://github.com/Laratypes/Laratype/pull/404) @ 23875e4e (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)); H45 [#342](https://github.com/Laratypes/Laratype/issues/342) proposed: PR [#345](https://github.com/Laratypes/Laratype/pull/345) @ [04fb575](https://github.com/Laratypes/Laratype/commit/04fb575); string body `text/plain` and `nosniff` merged @ e8633c9 (PR [#384](https://github.com/Laratypes/Laratype/pull/384)) (H41 [#336](https://github.com/Laratypes/Laratype/issues/336), breaking) |
| [Exceptions](#exceptions) | proposed: PR [#404](https://github.com/Laratypes/Laratype/pull/404) @ 23875e4e (H29 [#295](https://github.com/Laratypes/Laratype/issues/295), X3 [#392](https://github.com/Laratypes/Laratype/issues/392), H32 [#312](https://github.com/Laratypes/Laratype/issues/312)); error handling merged (#267, #272, #275); contract errors PR #307 @ 1d24eb0 (#108) |
| [Typed middleware](#typed-middleware) | merged @ 112ec823 (PR [#352](https://github.com/Laratypes/Laratype/pull/352)) |
| [Model binding](#model-binding) | proposed: PR [#379](https://github.com/Laratypes/Laratype/pull/379) @ 1578b639 (H7 [#118](https://github.com/Laratypes/Laratype/issues/118), M2); implicit binding planned → [#163](https://github.com/Laratypes/Laratype/issues/163) |
| [Policies on routes: .can()](#policies-on-routes-can) | planned → #122; superseded by planned → #105, #121 |
| [Authorization from the contract](#authorization-from-the-contract) | `r.scope()` merged ([#104](https://github.com/Laratypes/Laratype/issues/104)); planned → #105, #121 |
| [Request.ip()](#requestip) | proposed: PR [#400](https://github.com/Laratypes/Laratype/pull/400) @ 5fba1d5d (H30 [#299](https://github.com/Laratypes/Laratype/issues/299)) |
| [Rate limiting](#rate-limiting) | merged @ 9934cf2d (PR #305, H17); H30 text: PR [#400](https://github.com/Laratypes/Laratype/pull/400) @ 5fba1d5d; H34 [#319](https://github.com/Laratypes/Laratype/issues/319) follow-ups proposed: PR #PRNUM @ 7071858f |
| [Resources](#resources) | merged (PR [#309](https://github.com/Laratypes/Laratype/pull/309), H9); refused keys and generic `when()` proposed: PR [#334](https://github.com/Laratypes/Laratype/pull/334) @ c93aebf |
| [Interceptors](#interceptors) | merged @ 23ef6862 (PR [#415](https://github.com/Laratypes/Laratype/pull/415), H11 [#138](https://github.com/Laratypes/Laratype/issues/138)) |
| [Ad-hoc routes](#ad-hoc-routes) | proposed: PR #306 @ 9df674f; string body `text/plain` and `nosniff` merged @ e8633c9 (PR [#384](https://github.com/Laratypes/Laratype/pull/384)) (H41 [#336](https://github.com/Laratypes/Laratype/issues/336)); `Route.prefix(...)` and `group(...)` planned → [#321](https://github.com/Laratypes/Laratype/issues/321); `.name()` proposed: PR [#391](https://github.com/Laratypes/Laratype/pull/391) @ 952dae91 |
| [Route names and URLs](#route-names-and-urls) | proposed: PR [#391](https://github.com/Laratypes/Laratype/pull/391) @ 952dae91 |
| [CORS](#cors) | proposed: PR [#386](https://github.com/Laratypes/Laratype/pull/386) @ [c40f616](https://github.com/Laratypes/Laratype/commit/c40f616) (H15 [#164](https://github.com/Laratypes/Laratype/issues/164)) |
| [Undeclared-error check](#undeclared-error-check) | proposed: PR [#392](https://github.com/Laratypes/Laratype/pull/392) @ [bc10401](https://github.com/Laratypes/Laratype/commit/bc10401) (X3 [#157](https://github.com/Laratypes/Laratype/issues/157)); `sauf test` coverage split out → [#387](https://github.com/Laratypes/Laratype/issues/387) |

---

## Controller typing: Ctx and ControllerOf

### Status
Decided: S1 [#84](https://github.com/Laratypes/Laratype/issues/84) chose option A. Merged: `Ctx<E, Requires>`, `Result<E>` and `ControllerOf<C>` (H2a, H2b [#105](https://github.com/Laratypes/Laratype/issues/105)). `BaseCtx` with `params`, `query` and `body`: proposed: PR [#301](https://github.com/Laratypes/Laratype/pull/301) @ 4ea9155 (H3 [#106](https://github.com/Laratypes/Laratype/issues/106)): the runtime builds it for every `Route.api` route, and `Ctx` and the route's `Provided` share it. The spike's `fail()`, `ErrorReply` and the error branch of `Result<E>` are removed: errors are thrown, and framework errors come from the contract's capabilities (planned → [#108](https://github.com/Laratypes/Laratype/issues/108)).

### Public API
Reference shape from the S1 spike ([`s1-controller/lib/ctx.ts` @ 4c558fd](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/s1-controller/lib/ctx.ts)). This is not package code, and H2 may refine the names of the helper types:

```ts
// abridged: spike reference, see the permalink; fail() and ErrorReply are removed (see Status)
type Ctx<E extends AnyEndpoint, Requires extends object = {}>;   // BaseCtx<E> merged with Requires (params merged one level deep)
// BaseCtx<E> = { readonly endpoint: E; params: PathParams<path>; query: InferOut<query>; body: InferOut<body> }
type Result<E extends AnyEndpoint>;        // response schema INPUT (void if none)
type ControllerOf<C>;                       // { [endpoint key]: (ctx: any) => MaybePromise<Result<C[K]>> }; merged with | ResponseEscape (0.5 response()/JsonResource, unchecked; v2 resources, #123, return checked data)
```

Merged ([`packages/http/src/routing/api/proof.ts`](../../packages/http/src/routing/api/proof.ts)). The A2 #120 addition (`ctx.user`, the route's `AuthExtension` merged into the provided ctx) is proposed: PR [#414](https://github.com/Laratypes/Laratype/pull/414) @ 52a21000 ([`proof.ts` @ 52a21000](https://github.com/Laratypes/Laratype/blob/52a21000ad3e3ac5c525837ea6d19c8f1c332836/packages/http/src/routing/api/proof.ts)).

```ts
type BaseCtx<E extends AnyEndpoint, P = PathParams<E path>> = { readonly endpoint: E; params: P; query: InferOut<query>; body: InferOut<body> };
type Ctx<E extends AnyEndpoint, Requires extends object = {}>;   // BaseCtx<E> merged with Requires, params merged one level deep
type Result<E extends AnyEndpoint>;   // the response schema INPUT, void without one
type ControllerOf<C>;                 // { [endpoint key]: (ctx: any) => MaybePromise<Result<C[K]> | ResponseEscape> }, for a contract or its tree node
type ResponseEscape;                  // ResponseSupport | JsonResource: 0.5 response() / redirect() and 0.5 resources, unchecked (v2 resources return checked data, #123)
```

The first argument of a `Route.api` contract handler (`r.contract()`) is the ctx, a new object per request (H3 [#106](https://github.com/Laratypes/Laratype/issues/106)): `params` holds the raw path params (strings), folder params included; `query` and `body` hold the output of the endpoint's `query` and `body` schemas, or `undefined` for a slot without one. It is not the 0.5 request object any more; an [ad-hoc route](#ad-hoc-routes) has no contract, and its handler gets the 0.5 request. `Ctx<E>` knows the endpoint's own path params; a folder param (`user` of `users/[user]/posts`) is listed in `Requires`.

Usage (decided style; a bound model in `params` needs `r.bind()`, H7 #118):

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
- `ctx.user` comes from the endpoint's `auth` capability and is typed per guard. `Ctx` does not add it: a handler that reads `ctx.user` lists `user` in `Requires` with the guard's user type, `Ctx<typeof posts.destroy, { user: User }>`, and the route proof checks that entry against the route's auth (a route without auth, or another guard's user type, is a compile error) ([auth.md › Authentication from the contract](./auth.md#authentication-from-the-contract), [#120](https://github.com/Laratypes/Laratype/issues/120); A2 addition, proposed: PR [#414](https://github.com/Laratypes/Laratype/pull/414) @ 52a21000).
- `ctx.query` and `ctx.body` use the schema **output**, because they hold validated values.
- `ctx.endpoint` is a read-only runtime field that holds the endpoint, so interceptors ([#138](https://github.com/Laratypes/Laratype/issues/138)) and X3 [#157](https://github.com/Laratypes/Laratype/issues/157) can read it (merged, [#105](https://github.com/Laratypes/Laratype/issues/105)). It is a non-writable, non-configurable, non-enumerable own property of the ctx, and of the 0.5 request object that middleware gets, so each request and each endpoint sees its own, and spreading either doesn't copy it. 0.5 routes have no `endpoint`.
- **Return value:** a handler returns the response schema **input**, since the serializer runs afterwards.
- **Errors are thrown,** at any depth. A domain error is declared with `throws` ([contract.md › Domain errors](./contract.md#domain-errors)). Framework errors (401, 403, 404, 422, 429) come from the contract's capabilities and need no handler code.
- `implements ControllerOf<typeof c>` is optional. With it, a wrong return shape or a missing handler is reported at the method. Without it, the error appears at `r.contract()`.
- The runtime always calls `instance[key](ctx)`, never a detached reference (option A methods lose `this`). The instance comes from `app.make()` ([Controller resolution](#controller-resolution)).
- Option B (`x = action(endpoint, handler)`) is **not** shipped in v1. The route check accepts any callable property, so B can be added later without changing H2.

### Diagnostics
See [Route proof at r.contract()](#route-proof-at-rcontract).

### Example
Type tests: [`packages/http/__tests__/routing/route-proof.test-d.ts`](../../packages/http/__tests__/routing/route-proof.test-d.ts). The usage above is the S1 fixture `s1-controller/app/controllers/UserControllerA.ts`, with its `fail()` branch removed.

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
Merged (H2a, H2b [#105](https://github.com/Laratypes/Laratype/issues/105)): the `r.contract()` options and the route proof. The proof is generic in the middleware extensions and the bound params: `Route.api` runs it with the extensions and the `r.bind()` bindings its builder accumulated (typed middleware, H6 [#117](https://github.com/Laratypes/Laratype/issues/117), merged @ 112ec823 (PR [#352](https://github.com/Laratypes/Laratype/pull/352)); model binding, H7 [#118](https://github.com/Laratypes/Laratype/issues/118), proposed: PR [#379](https://github.com/Laratypes/Laratype/pull/379) @ 1578b639), with the `auth` capability's user (A2 [#120](https://github.com/Laratypes/Laratype/issues/120)). The A2 #120 additions (`AuthExtension` in the provided ctx and its two `user` diagnostics) are proposed: PR [#414](https://github.com/Laratypes/Laratype/pull/414) @ 52a21000 ([`proof.ts` @ 52a21000](https://github.com/Laratypes/Laratype/blob/52a21000ad3e3ac5c525837ea6d19c8f1c332836/packages/http/src/routing/api/proof.ts)). A handler that requires a model for a param no `.bind()` binds fails the proof; an unbound path param stays available as a string.

### Public API
Reference shape from the spike ([`s1-controller/lib/router.ts` @ 4c558fd](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/s1-controller/lib/router.ts)):

```ts
// abridged: spike reference, see the permalink
interface RouteBuilder<X extends object = {}, B extends Record<string, Binder> = {}> {
  middleware<const M extends readonly Middleware<any>[]>(...m: M): RouteBuilder<X & ExtOf<M>, B>;
  bind<const NB extends Record<string, Binder>>(bindings: NB): RouteBuilder<X, B & NB>;
  contract<C extends Contract, K extends ControllerClass>(contract: C, controller: K & VerifyController<C, InstanceType<K>, X, B>): void;
}
// runtime merged (E10, H2a #105): contract(contract, controller, { policy?, endpoints? }), see Router v2
// the merged Provided (below) puts the bound params over the extensions' params
```

Merged ([`packages/http/src/routing/api/proof.ts`](../../packages/http/src/routing/api/proof.ts), [`types.ts`](../../packages/http/src/routing/api/types.ts)).

The A2 #120 additions in this block (`AuthExtension` and the `Ctx` parameter of `VerifyController`) are proposed: PR [#414](https://github.com/Laratypes/Laratype/pull/414) @ 52a21000 ([`proof.ts` @ 52a21000](https://github.com/Laratypes/Laratype/blob/52a21000ad3e3ac5c525837ea6d19c8f1c332836/packages/http/src/routing/api/proof.ts)).

```ts
// What the runtime passes (H3 #106): BaseCtx with every path param of the full path, X, and the bound params
// A2 #120, proposed: PR #414 @ 52a21000: the auth capability's user is merged before X, so a route middleware's `user` type still wins
type AuthExtension<E, Ctx> = ResolvedAuth<E, Ctx> extends true | string ? { user: GuardUser<ResolvedAuth<E, Ctx>> } : {};
type WithBindings<X extends object, P, B> = Merge<X, { params: BoundParams<P, B> }>;   // a binding wins a key X.params also adds
type Provided<E, Path extends string, X extends object = {}, B = {}, Ctx = RootContext> =
  Merge<Merge<BaseCtx<E, FullParams>, AuthExtension<E, Ctx>>, WithBindings<X, FullParams, B>>;   // FullParams = PathParams<JoinPath<Path, E path>>, merged as in Ctx
// Low-level: unknown when the proof holds, else { "<diagnosis>": details }. H6 #117 feeds X, H7 #118 feeds B
type VerifyController<N extends string, C, Path extends string, I, X extends object = {}, B = {}, O = {}, Ctx extends EndpointContext = RootContext>;   // Ctx: the contract's scopes and options, for ResolvedAuth (A2 #120, proposed: PR #414 @ 52a21000)
type RouteProof<A, C, I, O, X extends object = {}, B = {}>;   // VerifyController for the tree entry r.contract() mounts, with the builder's X and B
type Merge<Base, Extra>;              // Base with Extra on top, params merged one level deep: the runtime's own merge rule (also what ExtOf merges a middleware tuple with)
type Binder;                          // a model class, a callable carrying its statics, or a resolver (raw: string) => value, for r.bind() (H7)

interface ApiRouteBuilder<A, M extends readonly MiddlewareItem[] = [], B extends Record<string, Binder> = {}> {
  bind<const NB extends Record<string, Binder>>(bindings: NB): ApiRouteBuilder<A, M, MergedBindings<B, NB>>;   // a key bound again is replaced
  contract<C extends ApiTreeContract<A> | ApiTreeNode<A>, K extends ControllerClass, P extends PolicyClass | undefined = undefined>(
    contract: C, controller: K & RouteProof<A, C, InstanceType<K>, { readonly policy: NoInfer<P> }, ExtOf<M>, B>,
    options?: ContractRouteOptions<NoInfer<C>, P>): MountedContract<C, B>;
}
```

`Merge<Base, Extra>` is exported too: `Ctx` and `Provided` build on it, and `ExtOf` merges a middleware tuple with it (H6 [#117](https://github.com/Laratypes/Laratype/issues/117)).

### Invariants
- **The controller declares, the route proves.** For each endpoint, the route computes `Provided = Merge<Merge<BaseCtx<E, FullParams>, AuthExtension>, WithBindings<MiddlewareExt, FullParams, Bound>>`, where `AuthExtension` adds the endpoint's `auth` user (`{ user: GuardUser<ResolvedAuth<...>> }`, nothing on a public route, A2 [#120](https://github.com/Laratypes/Laratype/issues/120)) and `WithBindings` merges the bound params over the extensions' `params` (a binding wins a key both add). Here `MiddlewareExt` is the extensions of the route builder's `r.middleware()` calls, merged in order as the runtime merges them (a later middleware wins a key, `params` one level deep; typed middleware, [Typed middleware](#typed-middleware)), and `Bound` is the `.bind()` map restricted to that endpoint's path params, the params of the contract's folders included. Without bindings `params` holds every path param as a string, so a handler that types one as a model fails with `missing .bind()?`. Since H3 [#106](https://github.com/Laratypes/Laratype/issues/106) the route passes the ctx, not the 0.5 request object, so a handler typed with that object fails.
- **Bound value types:** a `BindableModelClass` gives `InstanceType`; a callable that carries its statics gives the lookup result; any other resolver gives `NonNullable<Awaited<ReturnType>>`, because a miss is a 404 ([Model binding](#model-binding) › Invariants).
- **Requirement check:** `[Provided] extends [Param]` (one-directional), where `Param` is the handler's first parameter. Function assignability is **not** used: methods compare bivariantly, so a naive check would accept a handler that needs a middleware extension the route doesn't provide. A provided key typed `never` (a middleware declares it `never`) fails first with the extension diagnosis ([Typed middleware](#typed-middleware) › Diagnostics).
- **Return check:** `[Awaited<R>] extends [Result<E>]`; `null` too on an endpoint without a response schema (the runtime sends no body for either). A `response()` / `redirect()` value (its own status wins) and a 0.5 `JsonResource` also pass, unchecked, since the runtime takes them as is (`ResponseEscape`). A v2 resource ([Resources](#resources), H9 [#123](https://github.com/Laratypes/Laratype/issues/123)) returns plain data, which this check covers.
- **Second parameter:** the runtime passes the raw path params (strings) as the second argument, so a second parameter must accept them.
- **Handler type `any`:** passes. A policy known only as a `PolicyClass` (options in a variable typed `ContractRouteOptions`) can't be checked, so it passes too.
- **Also checked at `r.contract()`:**
  - exhaustiveness, so every endpoint needs a handler;
  - `.bind()` keys that are not a path param of any endpoint (`r.bind()`, H7 [#118](https://github.com/Laratypes/Laratype/issues/118));
  - a handler typed for a different endpoint (told by `ctx.endpoint`: two endpoints with identical types can't be told apart);
  - a base `Controller` member (`exposed`) is not a handler, as at runtime. The types also reject an own override of it in a subclass, and an `exposed()` method of a plain class (not a `Controller` subclass), though the runtime accepts both;
  - a middleware extension that names `query`, `body` or `endpoint` of a contract route: the route keeps them, so the proof refuses the key ([Typed middleware](#typed-middleware) › Invariants);
  - an endpoint with its own `.authorize()` needs the `policy` of `r.contract()`, with a method named after the endpoint or a `before` method (a property that is not a function doesn't count). A specific policy class that may be `undefined` is no policy; a policy typed `any` or only as `PolicyClass` (options typed `ContractRouteOptions<C>`) is not checked. For `.authorize(flag)` with a `boolean` flag, the types want a policy whatever the flag (stricter on purpose), while `Route.api`'s mount check, which wants a policy class as it does for a scope with `authorize`, fires only when the flag is `true` at runtime. Running the policy is [#121](https://github.com/Laratypes/Laratype/issues/121).
- **Handlers:** any callable property passes the type check (so `action()` can come later), but the runtime still requires class methods ([Router v2](#router-v2)).
- **Options:** `r.contract(c, Ctrl, { policy, endpoints: {...} })`, merged at runtime (H2a [#105](https://github.com/Laratypes/Laratype/issues/105), see [Router v2](#router-v2)).
  - `policy` covers the endpoints with `authorize` ([Authorization from the contract](#authorization-from-the-contract)). It is recorded, not run: running it is planned → [#121](https://github.com/Laratypes/Laratype/issues/121). The compile check that an `.authorize()` endpoint has one is merged (H2b [#105](https://github.com/Laratypes/Laratype/issues/105)).
  - `endpoints` holds per-endpoint middleware as callbacks keyed by endpoint name, for example `{ destroy: (r) => r.middleware(Audit) }`, with 0.5 `Middleware` classes: a `defineMiddleware()` value there is not proven (the callback type rejects it); the runtime still merges its extension into the ctx ([Typed middleware](#typed-middleware) › Non-goals). Endpoint names can't collide with option keys.
  - `options` and `endpoints` have `Object.prototype` or `null` as their prototype, with no inherited enumerable key: `r.contract()` throws otherwise (for example on a class instance or an `Object.create(base)` object), since a callback under an inherited key would be dropped (H22 [#271](https://github.com/Laratypes/Laratype/issues/271)). When its builder has no tree entry for the contract, `r.contract()` cannot name it, so `Route.api` throws when the item is mounted, with the same message. `r.contract()` copies every own key of both, non-enumerable ones included (so those are checked as unknown options or endpoint names too), into frozen objects with a `null` prototype: mutating the originals afterward changes no route, and nothing inherited is read.
- **Return check, errors:** errors are thrown, so the return check covers the response schema only.
- **Readable errors:** when the controller is valid, the controller parameter's type is `K & unknown`. Otherwise it is an object type whose **property names are the diagnosis**, because tsc prints missing property names in full but truncates property types.

### Diagnostics
Message templates from the S1 spike (real tsc 5.9.2 output in `s1-controller/tsc-errors.txt` @ 4c558fd). `<c>.<e>` is the route name:
- `` <c>.<e>: handler requires `<key>`, route does not provide it (add middleware / .bind()) ``, with `{ handler_requires: T }`
- `` <c>.<e>: handler requires `user`, route has no auth (add auth: true or a guard to the endpoint, its contract or a scope) `` (A2 [#120](https://github.com/Laratypes/Laratype/issues/120), proposed: PR [#414](https://github.com/Laratypes/Laratype/pull/414) @ 52a21000)
- `` <c>.<e>: `user` of the ctx does not match the guard's user type (the auth capability's guard) `` (A2 [#120](https://github.com/Laratypes/Laratype/issues/120), proposed: PR [#414](https://github.com/Laratypes/Laratype/pull/414) @ 52a21000)
- `` <c>.<e>: `<key>` provided by the route does not match the handler (missing .bind()?) ``, with `{ route_provides; handler_requires }`
- `` <c>.<e>: handler takes the 0.5 request (`<key>`), Route.api passes the ctx { endpoint, params, query, body } ``, for a member of the 0.5 request object the ctx doesn't have
- `` <c>.<e>: `query` of the ctx does not match the handler (it is the output of the endpoint's query schema) ``, and the same for `body`
- `<c>.<e>: handler ctx is typed for a different endpoint`
- `<c>.<e>: handler ctx does not accept what the route provides`, with `{ route_provides; handler_requires }`, when no single key explains it (a private member, a call signature)
- `<c>.<e>: the second parameter gets the raw path params (strings), use .bind() and ctx`
- `<c>.<e>: return type does not match the response schema`, with `{ expected; got }` (errors are thrown, so only the response schema counts)
- `<c>.<e>: controller has no handler for this endpoint`
- `` .bind(): `<key>` is not a path param of any endpoint in <contract> ``
- `<c>.<e>: endpoint has .authorize() but r.contract() has no { policy }`
- `` <c>.<e>: .authorize() needs a `<e>` method or `before` on the policy ``

Here `<key>` may be nested, for example `params.user`. At `r.contract()`, tsc reports them as a missing property of the controller argument: `Argument of type 'typeof PostController' is not assignable to parameter of type 'typeof PostController & { "posts.store: controller has no handler for this endpoint": undefined; }'`.

### Example
Planned shape (E3, E10; illustrative, no compiled example yet):
```ts
Route.api(appApi, (r) => {
  const bound = r.bind({ user: User })
  return [
    bound.scope('users/[user]', { policy: UserScopePolicy }),
    bound.contract(posts, PostController, { policy: PostPolicy, endpoints: { destroy: (r) => r.middleware(audit()) } }),
  ]
})
```

### Non-goals
- No runtime re-check of what the types already prove.

### Open questions
- Resolved: middleware for a single endpoint of a contract goes in a callback map keyed by endpoint name, under `endpoints` in the options of `r.contract()` ([#105](https://github.com/Laratypes/Laratype/issues/105), [#117](https://github.com/Laratypes/Laratype/issues/117)). The callbacks take 0.5 `Middleware` classes; a typed middleware there is a non-goal of the [#117](https://github.com/Laratypes/Laratype/issues/117) PR ([Typed middleware](#typed-middleware) › Non-goals).
- Resolved: an optional path param with `.bind()` is typed `Model | undefined`. An absent param gives `undefined`; a present param with no match gives 404 ([#118](https://github.com/Laratypes/Laratype/issues/118)).
- Type performance of `VerifyController` with 50+ endpoints → [#95](https://github.com/Laratypes/Laratype/issues/95) (S6)

### Acceptance
[#105 Done when](https://github.com/Laratypes/Laratype/issues/105)

---

## Router v2

### Status
merged ([#104](https://github.com/Laratypes/Laratype/issues/104)). The A2 #120 changes (the contract auth slot, and `RouteEntry.unenforced` / `UNENFORCED_NOTICE` dropping `auth`) are proposed: PR [#414](https://github.com/Laratypes/Laratype/pull/414) @ 52a21000. The production tree source is merged ([#125](https://github.com/Laratypes/Laratype/issues/125)): `examples/basic` builds and serves its `Route.api` routes in production. The registry move into the container is merged @ 714b11ba (PR [#362](https://github.com/Laratypes/Laratype/pull/362) → [#114](https://github.com/Laratypes/Laratype/issues/114), D7). Controllers are resolved with `Request.container().make()` ([Controller resolution](#controller-resolution), H2a [#105](https://github.com/Laratypes/Laratype/issues/105)) and run through the `RequestKernel` pipeline, which validates their query and body (H3 [#106](https://github.com/Laratypes/Laratype/issues/106), [Request pipeline](#request-pipeline)).

### Public API
[`packages/http/src/routing/api/ApiRouter.ts`](../../packages/http/src/routing/api/ApiRouter.ts) · [`packages/http/src/routing/api/types.ts`](../../packages/http/src/routing/api/types.ts)

The A2 #120 changes in this block (the contract auth slot, `RouteEntry.unenforced` and `UNENFORCED_NOTICE` without `auth`) are proposed: PR [#414](https://github.com/Laratypes/Laratype/pull/414) @ 52a21000 ([`packages/http/src/routing/api/contractAuth.ts` @ 52a21000](https://github.com/Laratypes/Laratype/blob/52a21000ad3e3ac5c525837ea6d19c8f1c332836/packages/http/src/routing/api/contractAuth.ts)).

```ts
class Route {
  static api<A extends object, const M extends readonly ApiRouteItem[]>(
    appApi: A, routes: (r: ApiRouteBuilder<A>) => M & CheckApiRoutes<A, M>): ApiRoutes;
}

interface ApiRouteBuilder<A, M extends readonly MiddlewareItem[] = [], B extends Record<string, Binder> = {}> {
  middleware<const W extends readonly MiddlewareItem[]>(...middleware: W): ApiRouteBuilder<A, [...M, ...W], B>;   // 0.5 classes or defineMiddleware values
  withoutMiddleware<const W extends readonly MiddlewareItem[]>(...middleware: W): ApiRouteBuilder<A, WithoutMiddleware<M, W>, B>;
  bind<const NB extends Record<string, Binder>>(bindings: NB): ApiRouteBuilder<A, M, MergedBindings<B, NB>>;   // a key bound again is replaced (Model binding)
  contract<C extends ApiTreeContract<A> | ApiTreeNode<A>, K extends ControllerClass, P extends PolicyClass | undefined = undefined>(
    contract: C, controller: K & RouteProof<A, C, InstanceType<K>, { readonly policy: NoInfer<P> }, ExtOf<M>, B>,
    options?: ContractRouteOptions<NoInfer<C>, P>): MountedContract<C, B>;            // a contract or its tree node; Route proof
  scope<D extends ApiScopeDir<A>>(dir: D, options: ScopeRouteOptions): MountedScope<D, B>;
  get: AdHocRouteMethod<"get">;                                                         // ad-hoc routes, see Ad-hoc routes
  post: AdHocRouteMethod<"post">;
  put: AdHocRouteMethod<"put">;
  patch: AdHocRouteMethod<"patch">;
  delete: AdHocRouteMethod<"delete">;
}

interface ContractRouteOptions<C, P extends PolicyClass | undefined = PolicyClass> {
  readonly policy?: P;                 // recorded; running it is #121
  readonly endpoints?: { readonly [K in EndpointKey<C>]?: EndpointCallback<K> };
}
interface ScopeRouteOptions {
  readonly policy: PolicyClass;        // recorded; running it is #121
}
type EndpointCallback<K> = K extends keyof Object       // not exported; a key named after an Object.prototype member
  ? ((r: EndpointRouteBuilder) => EndpointRouteBuilder) | (Object[K] extends () => unknown ? Object[K] : Function)
  : (r: EndpointRouteBuilder) => EndpointRouteBuilder;
// A map that leaves such a key out still has the inherited member, which TypeScript compares with the callback type,
// so the member's type is accepted too: toString, valueOf and toLocaleString take their own signature, constructor,
// hasOwnProperty, isPrototypeOf and propertyIsEnumerable any Function. A wrong callback there (a class, or one that does
// not return the builder) is a mount error, not a compile error

interface EndpointRouteBuilder {
  middleware(...middleware: MiddlewareClass[]): EndpointRouteBuilder;                   // 0.5 classes (H6 #117)
  withoutMiddleware(...middleware: MiddlewareClass[]): EndpointRouteBuilder;
}

class ApiRoutes {                                // exported as a type: only Route.api() builds one
  readonly routes: readonly RouteEntry[];        // the contract routes' registry entries, depth-first in tree order
  readonly adHoc: readonly AdHocRouteEntry[];    // the ad-hoc routes' entries, in callback order (see Ad-hoc routes)
  domain(domain: string): ApiRoutes;             // the same checked routes, served on that hostname only
  mount(app: Hono): (RouteEntry | AdHocRouteEntry)[];   // registers every route on Hono (by specificity), returns routes then adHoc
}

interface RouteEntry extends ApiRoute {          // name, method, path, endpoint, contract, scopes + resolved capabilities
  readonly controller: readonly [ControllerClass, string];
  readonly middleware: readonly MiddlewareItem[];   // 0.5 classes and typed middleware, in order
  readonly policies: ReadonlyArray<{ readonly dir: string; readonly policy: PolicyClass }>;
  readonly policy: PolicyClass | undefined;      // the policy of r.contract(), if any
  readonly bindings: Bindings;                   // r.bind() resolved per this route's path params (H7)
  readonly unenforced: readonly ("authorize" | "validation")[];   // what the router does not enforce yet (A2 #120 dropped "auth", proposed: PR #414 @ 52a21000)
  readonly domain: string | undefined;
}

type Ctx<E extends AnyEndpoint, Requires extends object = {}>;   // see Controller typing
type EndpointKey<C>;          // the endpoint keys of a contract or of its tree node
type ApiTreeName<A>;          // "users" | "users.posts"
type ApiTreeContract<A>;      // the contracts of the tree
type ApiTreeNode<A>;          // the tree nodes that hold a contract: typeof appApi.users | typeof appApi.users.posts
type ApiScopeDir<A>;          // "" | "users/[user]"
type ApiAuthorizeDir<A>;      // the scope folders with authorize
type CheckApiRoutes<A, M>;    // unknown, or { error: "Route.api: ..." }
const UNENFORCED_NOTICE: "authorize and headers schema validation are not enforced yet (planned → #121)";   // A2 #120, proposed: PR #414 @ 52a21000
// A2 #120, proposed: PR #414 @ 52a21000: the contract auth slot, filled by @laratype/auth on import
const CONTRACT_AUTH: unique symbol;                  // Symbol.for('laratype.http.contractAuth')
function registerContractAuth(factory: (guard: true | string) => AnyTypedMiddleware): void;   // A2 #120, proposed: PR #414 @ 52a21000
function contractAuth(): ((guard: true | string) => AnyTypedMiddleware) | undefined;   // only a function value; A2 #120, proposed: PR #414 @ 52a21000
```

The tree comes from `$api` ([contract.md › Contract folder tree](./contract.md#contract-folder-tree)). In dev, the `laratype:api` Vite plugin of `sauf` ([`packages/sauf/src/typegen/plugin.ts`](../../packages/sauf/src/typegen/plugin.ts)) resolves `$api` and scans the tree the first time the app imports it. `Binder`, `MergedBindings` and the `B` of `r.bind()` are [Model binding](#model-binding)'s.

### Invariants
- **Every contract exactly once.** The routes callback returns `r.contract()` and `r.scope()` items, and any ad-hoc routes (`r.get()`, ...; [Ad-hoc routes](#ad-hoc-routes)). A tree contract that is not mounted, or one mounted twice, is a compile error on the callback's return value and a runtime error in `Route.api`.
- **Contract or tree node.** `r.contract()` takes the contract or its tree node (`r.contract(appApi.users.posts, PostController)`). At compile time a contract is matched by its exact type and a tree node by its tree name; at runtime both are matched by value. Two contracts of the tree with identical types (`posts.ts` and `comments.ts` in one folder, both `{ index: endpoint.get('/').response(Dto) }`) can't be told apart by type, so mounting either by its contract is a compile error that asks for the tree node; mounted by their nodes, a missing or duplicate one is a compile error again.
- **Registration order.** Hono matches in registration order, so `mount()` registers the routes by specificity, not in tree order: comparing the path segments left to right, a static segment comes before a param constrained to one segment (`:id{[0-9]+}`), that one before a plain param (`:slug`), a plain param before a regex param that can match `/` (`:path{.+}`: an unescaped `.`, a `/`, a negated class `[^...]`, or `\S`, `\W`, `\D`), and that one before a wildcard (a stable sort, so equal routes keep their tree order). A parent's param route therefore never shadows a child's static one: with `users.ts` `{ show: '/:user' }` and `users/me.ts` `{ index: '/' }`, `GET /api/users/me` reaches `users.me.index`. With `files.ts` `{ show: '/:path{.+}' }` and `files/[id]/raw.ts`, `GET /api/files/42/raw` reaches the raw route; with `/:slug` and `/:id{[0-9]+}` at the same position, `GET /api/posts/42` reaches the id route and `/api/posts/abc` the slug one. `routes` and the returned entries keep the tree order.
  - Known limitation: the sort is per `Route.api`. Other `Route.api` groups and 0.5 `defineRouteGroup` routes register in the order the providers mount them, so a param route of one group can still shadow a static route of another: mount order matters across groups.
- **URLs from the tree.** A contract route's path is the full path from `apiRoutes()` (the folder tree plus the endpoint path), so contract routes take no prefix. Ad-hoc routes take their path as written ([Ad-hoc routes](#ad-hoc-routes); `Route.prefix(...)` and `group(...)` for them: planned → [#321](https://github.com/Laratypes/Laratype/issues/321)), and the 0.5 `defineRouteGroup` routes keep working next to `Route.api`.
- **Handlers.** Each endpoint runs the controller method named after its key. Handlers must be class (prototype) methods of the controller or of a class between it and the base `Controller`: an arrow-function class field, `constructor`, an `Object.prototype` method or a base `Controller` method is not a handler, and is reported like a missing method. A controller without that method, or an `undefined` controller (usually a circular import), is a runtime error in `Route.api`. The compile check of the controller is the [Route proof at r.contract()](#route-proof-at-rcontract) (H2b [#105](https://github.com/Laratypes/Laratype/issues/105)).
- **Scopes.** `r.scope('<folder>', { policy })` names a scope folder of the tree, written as the `dir` of the entry's `{ scope, dir }` (root-relative, `""` for the root; [contract.md › defineApi and route names](./contract.md#defineapi-and-route-names)). A folder that is not a scope of the tree is an error at the argument and at runtime. A scope with `authorize` and no `r.scope()` is a compile error and a runtime error, and so is a scope mounted twice.
- **Status.** A contract route answers with its endpoint's status (`.response(schema[, status])` or `.status(n)`; 200 with a response schema, 204 with no body without one, and a 205 from `.status(205)` has no body either, see [Response from the contract](#response-from-the-contract)), passed to the 0.5 kernel as `RouteParams.status`, never one guessed from the method name. A `Response` the handler returns with its own status still wins. A 0.5 status decorator on the handler that disagrees with the endpoint's status is a runtime error in `Route.api`; an equal one is fine.
- **Path params are raw.** Contract routes skip the 0.5 implicit and `Route.model` binding (`RouteParams.modelBinding: false`), so a `[user]` folder never runs a 0.5 lookup or answers an undeclared 404. A folder param is raw unless `r.bind()` binds it: a bound one runs its binder, and a miss is the contract's 404 (Model binding). The handler's second argument is the raw params object, whatever is bound (`show(ctx, { user })` gets the string). Model binding for contracts is `r.bind` ([Model binding](#model-binding), H7 [#118](https://github.com/Laratypes/Laratype/issues/118)).
- **Policies are recorded, not run.** A mounted scope policy is recorded on each route under its folder (`RouteEntry.policies`, outer to inner), and the `policy` of `r.contract()` on each route of the contract (`RouteEntry.policy`). Running them is planned → [#121](https://github.com/Laratypes/Laratype/issues/121): a scope policy's `before` needs the signed-in user ([#120](https://github.com/Laratypes/Laratype/issues/120)) and the bound models ([#118](https://github.com/Laratypes/Laratype/issues/118)).
- **Auth is enforced; `authorize` and headers validation are not yet.** A route whose resolved `auth` is set gets its guard middleware prepended at `mount()`, so it runs on every request before the route middleware, `r.bind()` bindings, validation and the handler ([auth.md › Authentication from the contract](./auth.md#authentication-from-the-contract), A2 [#120](https://github.com/Laratypes/Laratype/issues/120)). A route with auth whose factory is missing fails `mount()` closed. `authorize` is still recorded, not run, until [#121](https://github.com/Laratypes/Laratype/issues/121). A resolved `throttle` is enforced by `mount()` ([Rate limiting](#rate-limiting)). The query and body schemas are validated (H3 [#106](https://github.com/Laratypes/Laratype/issues/106), proposed: PR [#301](https://github.com/Laratypes/Laratype/pull/301) @ 4ea9155); a headers schema is not, so a route whose endpoint has one is listed with `validation`. `RouteEntry.unenforced` records which of `authorize` and `validation` apply. `mount()` logs one warning that lists those routes, once per process for each route list (the printed lists are remembered, up to 32, oldest dropped first, so an `--hmr` restart that mounts the same `Route.api` groups does not repeat it), and `sauf route:list` shows them in its "Not enforced" column (its "Policies" column lists the scope policies, then `contract: <Policy>`).
- **Middleware.** `r.middleware(...)` before `.scope()` applies to every contract under that folder; before `.contract()`, to that contract; in `r.contract(c, Ctrl, { endpoints: { <key>: (r) => r.middleware(...) } })`, to that endpoint only. A route's middleware is its scopes' (outer to inner), then its contract's, then its endpoint's, with duplicates removed: a middleware mounted at several levels (for example from one `r.middleware(Web)` builder used for a scope and a contract) runs once, at its first position. `r.middleware()` takes 0.5 `Middleware` classes and typed middleware ([Typed middleware](#typed-middleware)); `r.withoutMiddleware(...)` drops what the builder accumulated. The `endpoints` callbacks take 0.5 classes only.
- **Domain.** `.domain('api.example.com')` serves the routes on that hostname only. The hostname is made of non-empty labels of letters, digits and inner hyphens. `.domain()` re-labels the routes `Route.api` already checked. The match reads the `Host` header only (the request URL's host when there is none, as with an in-process `app.request()`), never `X-Forwarded-Host`: behind a proxy, the proxy must preserve the `Host` header. It ignores case, the request port (dev Host headers carry `:3000`) and one trailing dot (`api.example.com.`). A request for another host falls through to the next matching route, or gets a 404. `.domain()` is name-based virtual hosting, not an access-control boundary: any client can send any `Host` header, so no guard or policy may key on the domain alone.
- **Registry.** `mount()` returns one `RouteEntry` per contract route, then one `AdHocRouteEntry` per ad-hoc route ([Ad-hoc routes](#ad-hoc-routes)). `RouteAppServiceProvider.boot()` binds what `routes()` returns as a `RouteRegistry` in the app container (D7 [#114](https://github.com/Laratypes/Laratype/issues/114)), and `sauf route:list` reads `RouteRegistry.current().routes`, both v2 and 0.5 entries.
- **Tree source.** In dev, the `laratype:api` plugin runs G1's scan and emit (`syncContractTree`: `$types.d.ts` and `index.gen.ts`, with no TS checker and no `api.ts`) with config `api.root` / `api.base` from `app/config/config.ts`, then resolves `$api` to `.laratype/api/index.gen.ts`. The config is read outside the app's module graph: the project's `.env` is loaded first (`loadEnv`, as `EnvLoadServiceProvider` does), then the file is imported by an isolated jiti instance with no module cache, so the app's own later import evaluates it fresh with env loaded, and a config importing a module still loading up the app's import chain cannot deadlock the scan. That import evaluates the config's whole import graph, so the plugin runs it again only when the content of `app/config/config.ts` changed: a rescan for a contract added or deleted reuses the last value, and a failed read is not kept.
  - Known limitations of the config read: the isolated import knows no Vite or tsconfig `paths` alias, so `app/config/config.ts` and the modules it imports can't use aliases in dev; such an import fails with `[laratype:api] app/config/config.ts could not be imported on its own (no Vite or tsconfig path aliases there): <error>`. The cache is keyed on the text of `app/config/config.ts` only: after a change to `.env` or to a module the config imports, touch `config.ts` or restart `sauf dev` before `api.root` / `api.base` pick it up.
  - The first `$api` import scans the tree. Once the app has imported `$api`, `sauf dev --hmr` rescans before a restart only when the tree can have changed: a file added or deleted under the root, or the config file changed, added or deleted (see below). An edited config applies on that restart. An app that never imports `$api` is never scanned, so a 0.5 app with helpers in `app/api` still boots. Only files the scan reads count as tree files: no private `_x` / `$x` folders, non-`.ts` files or editor temp files. A failed scan is not cached. Independently of `--hmr`, the dev type watch (G2 [#142](https://github.com/Laratypes/Laratype/issues/142), merged @ 8ad92ae9) rescans on the same events and rewrites `$types.d.ts` / `index.gen.ts` without a restart; a content-only edit is not a scan trigger (the generated files import the contract, [typegen.md › Watch mode in sauf dev](./typegen.md#watch-mode-in-sauf-dev)).
  - Under `--hmr`, adding or deleting a file under the contract root (a contract or a `_scope.ts`) restarts the server like a change does, so `$api` follows. Restarts are coalesced: while one runs, any number of new events queue exactly one more. A failed restart releases what did boot (the providers' `down()` runs, and the Hono app and container are reset). Stopping an instance runs every cleanup even when one throws, then always resets the app (`Serve.stop()`), leaves no server, and requests get a 503 until the next change starts one. The tree is rescanned only when a file is added or deleted under the root, or the config file is changed, added or deleted. Until a scan has read the config, the root is the default `app/api`.
  - Files are written only when their content changes. When `index.gen.ts` changes, its module is invalidated (by its normalized module id). Writes under the plugin's output folder don't trigger an `--hmr` restart.
  - When the root folder doesn't exist, importing `$api` fails with `[laratype:api] the app imports $api, but the contract tree root "<root>" does not exist (set config api.root)`, and a stale `index.gen.ts` is never served: a restart that finds the root gone invalidates the index module and its importers, and loading the index fails with the same error. Scan and config errors are printed with the prefix `[laratype:api] `. `app/config/config.ts` must not import `$api`, directly or through other modules: `$api` is generated from the tree the config locates, and the isolated import cannot resolve it. That fails with `[laratype:api] app/config/config.ts must not import $api (directly or indirectly)`.
  - The router itself never scans: it takes the `appApi` value.
  - In production nothing scans (merged, [#125](https://github.com/Laratypes/Laratype/issues/125)). The build script is `sauf types:generate && tsc -b tsconfig.build.json && sauf build`. `tsconfig.build.json` has `"rootDir": "."` (so `dist` mirrors the project and `dist/.laratype/api/index.gen.js` finds `../../app/api/*`), `rootDirs: [".", ".laratype/types"]` (for `./$types`), `.laratype/api` in `include` (plus `database` with the v1 layout), and `paths: { "$api": ["./.laratype/api/index.gen.ts"] }`, which `sauf build` rewrites (`tsc-alias`) in the emitted files ([build.md › Plugin chain](./build.md#plugin-chain)).
  - Regenerating the files without a restart, and for the FE, is merged @ 8ad92ae9 ([#142](https://github.com/Laratypes/Laratype/issues/142)). The watch writes the files; reloading the running server's routes without a restart is a follow-up ([typegen.md › Watch mode in sauf dev](./typegen.md#watch-mode-in-sauf-dev)).
- **Replaces** `_createNestedRoute` and the 0.5 `RouteOptions` tree for contract routes. Both stay for the 0.5 routes until those are migrated.

### Diagnostics
Type-level, as the `error` property that the callback's return value is missing:
- `Route.api: contract "<tree name>" is not mounted (add r.contract())`
- `Route.api: contract "<tree name>" is mounted twice`
- `Route.api: scope "<folder>" has authorize but no policy (add r.scope() with { policy })`
- `Route.api: scope "<folder>" is mounted twice`
- `Route.api: contract "<tree name>" has the type of another contract of the tree: mount it with its tree node, r.contract(appApi.<name>, ...)`
- `Route.api: a mounted contract is not in the API tree`

A contract or a folder outside the tree, and `r.scope()` without `{ policy }`, are argument type errors.

Runtime `Error`s, prefixed `[@laratype/http] Route.api: `:
- `contract "<tree name>"[, "<tree name>"] is not mounted (add r.contract())`
- `contract "<tree name>" is mounted twice`
- `a mounted contract is not in the API tree`
- `scope "<folder>" has authorize but no policy (add r.scope('<folder>', { policy }))`
- `scope "<folder>" is mounted twice`
- `"<folder>" is not a scope folder of the API tree (folders: "<folder>", ...)`
- `r.scope('<folder>') needs { policy }`
- `<route name>: <Controller> has no method "<key>" (handlers must be class methods, not arrow-function fields)`
- `contract "<tree name>": r.contract() got <value> as its controller (a circular import?)`
- `<route name>: <Controller>.<key> has status <n> from its status decorator, but the endpoint declares <m>: declare .response(schema, <n>) on the endpoint, or drop the decorator`
- `expected the appApi tree built with defineApi` (told by the root brand, `isApiRoot`: a hand-made object of nodes is rejected; `Route.api` also requires the brand in its type, so most such calls fail to compile)
- `the routes callback must return an array of r.contract(), r.scope() and ad-hoc routes (r.get(), ...)`
- `the routes callback must return r.contract(), r.scope() and ad-hoc route (r.get(), ...) items`
- `.domain("<domain>") must be a hostname, such as "api.example.com"`
- `<route name>: endpoint has .authorize() but r.contract() has no { policy }`
- `contract "<tree name>": r.contract() options must be { policy?, endpoints? }`
- `contract "<tree name>": r.contract() options must be { policy?, endpoints? }, not options.<key>`
- `contract "<tree name>": { policy } must be a policy class`
- `contract "<tree name>": { endpoints } must map endpoint names to (r) => r.middleware(...)`
- `contract "<tree name>": options.<key> is inherited: options must have own keys only` (and `endpoints.<key> is inherited: endpoints must have own keys only`)
- `contract "<tree name>": options must have Object.prototype or null as its prototype, not a class instance or an Object.create(base) object` (and `endpoints must have ...`)
- `contract "<tree name>": endpoints.<key> is not an endpoint of the contract (endpoints: "<key>", ...)`
- `contract "<tree name>": endpoints.<key> must be a callback, (r) => r.middleware(...)`
- `<route name>: endpoints.<key> must return the builder it gets, (r) => r.middleware(...)`

Warning, logged once per `mount()` when some routes have a non-empty `unenforced`: `[@laratype/http] Route.api: authorize and headers schema validation are not enforced yet (planned → #121), so these routes skip those checks: <route name> (authorize[, validation]), ...`

At `mount()`, a route whose resolved `auth` is set but `@laratype/auth` is not imported (or the slot holds no function) fails: `[@laratype/http] Route.api: <route name>: the contract declares auth, but @laratype/auth is not imported.`

### Example
[`examples/basic/app/routes/api.ts`](../../examples/basic/app/routes/api.ts) mounts [`app/api/posts.ts`](../../examples/basic/app/api/posts.ts) and [`app/api/users.ts`](../../examples/basic/app/api/users.ts) (a v1 `UserController` with constructor DI, tested in `examples/basic/__tests__/`), and its `RouteServiceProvider` registers them with `apiRoutes.mount(this.apps)`. With scopes:

```ts
import { appApi } from '$api'
export const apiRoutes = Route.api(appApi, (r) => [
  r.contract(users, UserController),
  r.middleware(Audit).scope('users/[user]', { policy: UserScopePolicy }),
  r.contract(usersPosts, PostController),
]).domain('api.example.com')
```

Tests: [`packages/http/__tests__/routing/ApiRouter.test.ts`](../../packages/http/__tests__/routing/ApiRouter.test.ts) (requests through `app.request()`), [`controllerResolution.test.ts`](../../packages/http/__tests__/routing/controllerResolution.test.ts) (constructor DI, `endpoints`, `ctx.endpoint`) and [`router.test-d.ts`](../../packages/http/__tests__/routing/router.test-d.ts) (type errors).

### Non-goals
- No policy execution: [#121](https://github.com/Laratypes/Laratype/issues/121).
- No implicit model binding: path params that match a model bind on their own only once H14 [#163](https://github.com/Laratypes/Laratype/issues/163) lands. The explicit `r.bind()` is [Model binding](#model-binding) (H7 [#118](https://github.com/Laratypes/Laratype/issues/118), proposed: PR [#379](https://github.com/Laratypes/Laratype/pull/379)).
- No 403 from the contract's capabilities: [#121](https://github.com/Laratypes/Laratype/issues/121). The 401 comes from `auth` (A2 [#120](https://github.com/Laratypes/Laratype/issues/120)), the 429 is in [Rate limiting](#rate-limiting).
- No domain params (`{account}.example.com`).

### Open questions
- None recorded.

### Acceptance
[#104 Done when](https://github.com/Laratypes/Laratype/issues/104)

---

## Controller resolution

### Status
merged ([#105](https://github.com/Laratypes/Laratype/issues/105), H2a). The request scope is proposed: PR [#327](https://github.com/Laratypes/Laratype/pull/327) @ 3b2d2fe (D6 [#112](https://github.com/Laratypes/Laratype/issues/112)), specified in [di.md › Request scope and scope bubbling](./di.md#request-scope-and-scope-bubbling). The fallback-container warning and the core no-metadata hint (D9 [#270](https://github.com/Laratypes/Laratype/issues/270)) are proposed: PR [#294](https://github.com/Laratypes/Laratype/pull/294) @ 40faad5.

### Invariants
- **Resolution:** `Request.controllerKernel` resolves the controller with `Request.container().make(Controller)` instead of `new`, for `Route.api` and 0.5 routes alike. That gives constructor DI through the [DI transform](./di.md#di-transform), and an app binding of the controller or of its dependencies applies.
- **Which container:** `RequestKernel.boot()` creates one request scope of the app container per request (`createRequestScope()`), puts it on the request (`ContextApi.getContainer()`, `RequestKernel.container()`) and starts its disposal when the handler settles: after its response, or after it throws, once the error handler has answered. The middleware does not await the disposal, so a slow disposer never delays the response and one that never settles never hangs it; a failed one is logged once and never changes the response ([di.md › Request scope and scope bubbling](./di.md#request-scope-and-scope-bubbling)). Controllers resolve from it, so app bindings apply and a request-scoped dependency is built once per request. Outside `RequestKernel` (a bare Hono app, as in tests), controllers are autowired without app bindings, by one container created on first use. Creating it prints one `console.warn` per process (module copies and dev restarts included), except in production (`globalThis.__PROD__`, or `NODE_ENV=production` when `__PROD__` is unset): ``[@laratype/http] No app container outside a RequestKernel request, so controllers (and RequestKernel.container()) use an autowire-only container: app bindings don't apply, and every request shares the singletons it autowires. Serve routes through RequestKernel to resolve them from the app container.`` ([#270](https://github.com/Laratypes/Laratype/issues/270)).
- **Lifetime:** an unbound controller is transient: a new instance per request, as with `new`. A binding's scope (`singleton`, `@Injectable({ scope })`) applies as it does anywhere else.
- **Request-scoped dependencies:** a transient controller that depends on a request-scoped provider gets the request's value and needs no bubbling. A singleton controller (a binding, or `@Injectable({ scope: 'singleton' })`) that depends on one bubbles to request scope, with one dev warning per key ([di.md › Request scope and scope bubbling](./di.md#request-scope-and-scope-bubbling)).
- **Errors:** a dependency the container cannot resolve is a `DiError` when the request runs, not when the routes mount. A controller (0.5 too) whose constructor takes params needs the [DI transform](./di.md#di-transform)'s metadata **when the container autowires it**: app code the `laratype:di` plugin compiles works, or an app-container factory binding of the controller resolves it without metadata. Under `RequestKernel`, `Request.container()` is the request scope, so that binding is visible; a bare Hono app uses the autowire-only fallback container described above and has no app bindings. A class binding of the controller to itself still autowires, so it does not skip the metadata. Without either path it fails where `new` used to pass `undefined`: ``Cannot autowire <Controller>: its constructor takes <n> param(s) but no dependency metadata was found.`` followed by a factory-binding hint (and the plugin fix for app code; the exact dev and production texts are in [di.md › Resolution errors with fix hints](./di.md#resolution-errors-with-fix-hints)). `@Inject` can't fix a controller with no metadata: the container fails before it reads `@Inject`.
- **Mount checks read the declared class:** the handler and status-decorator checks of `Route.api` read the class passed to `r.contract()`. A binding of that class should be a subclass of it.
- **Kernel container:** the kernel container passes `{ deps: depsRegistry }`, merged ([#102](https://github.com/Laratypes/Laratype/issues/102)).

### Example
Tests: [`packages/http/__tests__/routing/controllerResolution.test.ts`](../../packages/http/__tests__/routing/controllerResolution.test.ts) and [`requestScope.test.ts`](../../packages/http/__tests__/routing/requestScope.test.ts) (parallel requests, and disposal after the response: the slow and failing disposers awaited through the kernel's internal `settled()` hook, and a disposer that never settles proven not to hang the response). In `examples/basic`, `GreetingService` is injected into `GreetingController` with no decorator.

### Acceptance
[#105 Done when](https://github.com/Laratypes/Laratype/issues/105)

---

## Middleware and policy resolution

### Status
proposed: PR [#351](https://github.com/Laratypes/Laratype/pull/351) @ 9e9f4c4 (H21 [#269](https://github.com/Laratypes/Laratype/issues/269)). The controller path it mirrors is merged ([#105](https://github.com/Laratypes/Laratype/issues/105), H2a).

### Public API
No new export in `@laratype/http`: the pipeline resolves through `Request.container()` ([`Request.ts` @ 9e9f4c4](https://github.com/Laratypes/Laratype/blob/9e9f4c4/packages/http/src/request/Request.ts#L257-L286)), the container [Controller resolution](#controller-resolution) already uses. `MiddlewareClass` is `Newable<Middleware>`, so a middleware whose constructor requires dependencies is accepted in `RouteOptions.middleware` / `withoutMiddleware` and in the `r.middleware()` stack ([`types.ts` @ 9e9f4c4](https://github.com/Laratypes/Laratype/blob/9e9f4c4/packages/http/src/routing/api/types.ts#L18-L19)); the old `typeof Middleware` had a no-argument construct signature and rejected it. The exported `PolicyFactory` type changes one member: `handle` takes the policy instance the pipeline resolved, so a factory can no longer expect a class ([`Route.ts` @ 9e9f4c4](https://github.com/Laratypes/Laratype/blob/9e9f4c4/packages/http/src/contracts/Route.ts#L11-L17)), a signature change internal to `can()` and the pipeline ([`RoutePolicy.ts` @ 9e9f4c4](https://github.com/Laratypes/Laratype/blob/9e9f4c4/packages/auth/src/policies/RoutePolicy.ts#L23-L24)). `@UsePolicy`'s parameter widens to `Newable<Policy>`, so a policy class with constructor params can be declared on a model, and the `can()`/`cannot()` it adds resolve that class with `RequestKernel.container().make(P)` when they run ([`Policy.ts` @ 9e9f4c4](https://github.com/Laratypes/Laratype/blob/9e9f4c4/packages/auth/src/decorators/Policy.ts#L13-L17)). A refusal answers 401 with `@laratype/support`'s `UnauthorizedException` ([`UnauthorizedException.ts` @ 9e9f4c4](https://github.com/Laratypes/Laratype/blob/9e9f4c4/packages/support/src/exception/UnauthorizedException.ts)), the 0.5 `{ code: "UNAUTHORIZED", message }` shape, so `@laratype/http` imports nothing from `@laratype/auth`.

```ts
// @laratype/http, contracts/Route.ts
type PolicyFactory = {
  ability: Ability;
  args: any[];
  modelPolicy: any;
  handle: (ability: Ability, policy: Policy, ...args: any[]) => Promise<boolean>;
};
// @laratype/auth, RoutePolicy.ts: not exported (reached through `can()`), and it never builds the policy
class RoutePolicy {
  static handle<T extends Ability>(ability: T, policy: Policy, ...models: any): Promise<boolean>;
}
// @laratype/auth, decorators/Policy.ts: the class decorator records P and adds can()/cannot()
interface UsePolicy<T extends Policy> {
  can<U extends Ability>(ability: U, ...args: ExcludeFirstParameter<T[U]>): ReturnType<T[U]>;
  cannot<U extends Ability>(ability: U, ...args: ExcludeFirstParameter<T[U]>): ReturnType<T[U]>;
}
export function UsePolicy(P: Newable<Policy>): <T extends { new(...args: any[]): {} }>(target: T) => {
  new (...args: any[]): {
    can(ability: Ability, ...args: any): boolean | Promise<boolean>;
    cannot(ability: Ability, ...args: any): boolean | Promise<boolean>;
  };
} & T;
```

### Invariants
- **Middleware:** every middleware class the pipeline runs is resolved with `Request.container().make(...)` instead of `new`, whatever mounted it: the `r.middleware()` stack of a contract or a scope, the per-endpoint `endpoints` map of `r.contract()`, an ad-hoc route's, and 0.5 `Route.group` middleware (a group's own and its parents', so a group at the root too). A middleware's constructor params are injected through the [DI transform](./di.md#di-transform) metadata, and an app binding of the middleware or of a dependency applies.
- **Policies:** the 0.5 `can()` step resolves the class `@UsePolicy` records on the model with the same container, then hands the instance to `PolicyFactory.handle`. The `can()`/`cannot()` methods `@UsePolicy` adds to the model resolve that class at call time too, so decoration only records it and defining the model needs no container. `Policy.before()` runs on that resolved instance, so an override that reads a constructor dependency gets it too, through a route policy and model-level `can()`/`cannot()` alike. Running contract policies (`r.scope()` and `r.contract()` `{ policy }`) is still planned → [#121](https://github.com/Laratypes/Laratype/issues/121): they are recorded, not resolved.
- **Policy refusals:** a `can` step with no authenticated user answers 401 (`UNAUTHORIZED`, "You are not authorized to perform this action."), and the controller does not run. A custom `PolicyFactory.handle` must resolve to `true` to allow the request; any other result, `undefined` included, is refused the same way.
- **Which container:** exactly the controller's ([Controller resolution](#controller-resolution)): middleware and policies resolve from the same request scope of the app container (`RequestKernel.boot()`), and from the same autowire-only fallback container outside `RequestKernel`, so app bindings and request-scoped dependencies apply to them too. The model-level `can()`/`cannot()` of `@UsePolicy` use the same `RequestKernel.container()`, so a caller outside a request gets the fallback container and its one-time warning.
- **Lifetime:** unbound, a middleware or policy is transient, so a new instance per request, as with `new`. A binding's scope (`singleton`, `@Injectable({ scope })`) applies as it does anywhere else. The 0.5 `previousResult` is per request and per run: the pipeline keys the value by the request and the middleware instance, not on the instance alone, so a `singleton` serving concurrent requests still reads the value its own request's previous middleware passed, before and after `next()`, and it restores the value it found when a run ends, so the same instance mounted at a group and at its route keeps each mount's value. `setPreviousResult()` and `getPreviousResult()` keep their 0.5 signatures, and the 0.5 `protected previousResult` field is an accessor over them, so a 0.5 middleware that reads or writes the field directly gets the request-local value; outside a request context the instance keeps its own value. A subclass that redeclares the field (`protected previousResult!: T`) would hide the accessor under define semantics, so the pipeline refuses it (Diagnostics).
- **Errors:** a class whose constructor takes params and has no dependency metadata is a `DiError` when the request runs, not when the routes mount, with the controller's `Cannot autowire` hint ([di.md › Resolution errors with fix hints](./di.md#resolution-errors-with-fix-hints)). Before, `new` passed `undefined` silently. The model-level `can()`/`cannot()` of `@UsePolicy` fail the same way when they resolve the policy.
- **Ordering:** unchanged: resolution happens in `RequestKernel.handle`'s pipeline, where the class was built before.

### Diagnostics
The [Controller resolution](#controller-resolution) ones: `Cannot autowire <Middleware>` and `Cannot resolve <Middleware> constructor param #<n> \`<name>\`: ...`, from [Container](./di.md#container).
- `InternalException`: `[@laratype/http] <Middleware> declares previousResult as a class field, which hides the request-local previous result. Fix: remove the field, use \`declare\`, or type it through Middleware<T>.` when the resolved middleware has an own `previousResult` property; the request is a 500.

### Example
Tests: [`packages/http/__tests__/request/containerResolution.test.ts`](../../packages/http/__tests__/request/containerResolution.test.ts) (a contract route's middleware and an endpoint's, a 0.5 route's and a 0.5 group's, a binding of the middleware class, the fallback container, one instance per request, a `DiError` for missing metadata, a policy declared with `@UsePolicy` whose injected dependency decides, a `before()` that reads an injected dependency through a route policy and through model-level `can()`, a model whose `can()` resolves a `@UsePolicy` policy per request from the container while decoration builds nothing, a `can` step with no authenticated user answering 401, and a custom handler resolving `false` or `undefined`), [`previousResult.test.ts`](../../packages/http/__tests__/request/previousResult.test.ts) (one singleton middleware, two concurrent requests interleaving across an `await`, each reading its own previous result before and after `next()`; and one singleton mounted at group and route level, each mount keeping its own value), and the type test [`middleware.test-d.ts`](../../packages/http/__tests__/routing/middleware.test-d.ts) (a middleware with a required constructor dependency in the 0.5 `Route` options and `RequestKernel.handle`, and in `r.middleware()` and an `endpoints` callback; a non-middleware class is still rejected).

### Non-goals
- Running contract policies ([#121](https://github.com/Laratypes/Laratype/issues/121)) and typed middleware ([#117](https://github.com/Laratypes/Laratype/issues/117)): this only changes how the class is built.

### Open questions
- None recorded.

### Acceptance
[#269 Done when](https://github.com/Laratypes/Laratype/issues/269)

---

## Request pipeline

### Status
Parsing, validation and the handler ctx: proposed: PR [#345](https://github.com/Laratypes/Laratype/pull/345) @ e54cb4d (H3 [#106](https://github.com/Laratypes/Laratype/issues/106), H43 [#340](https://github.com/Laratypes/Laratype/issues/340), see [validation.md › Pipeline validation and 422](./validation.md#pipeline-validation-and-422)). Interceptors merged @ 23ef6862 (PR [#415](https://github.com/Laratypes/Laratype/pull/415), H11 [#138](https://github.com/Laratypes/Laratype/issues/138)). The pipeline still runs inside `RequestKernel.handle`; the auth guard is enforced from the contract since A2 [#120](https://github.com/Laratypes/Laratype/issues/120) (inside the kernel, after the mount-level rate limit), and the policy steps are planned → [#121](https://github.com/Laratypes/Laratype/issues/121); the contract's rate limit runs before the route middleware ([Rate limiting](#rate-limiting)).

### Public API
No new export. The parsing and validation steps run inside `RequestKernel.handle`, and the handler ctx is `Ctx<E>`: the signatures, permalinked at the SHA in Status, are in [validation.md › Pipeline validation and 422](./validation.md#pipeline-validation-and-422) and [Controller typing](#controller-typing-ctx-and-controllerof).

### Invariants
- **Parsing and validation (H3):** the body by media type, the query and params, the order (the body is read at the start of `RequestKernel.handle`, before the route middleware; validation runs after middleware and policies, before the handler), the 400 and 422 bodies, an empty body as `{}` on every method, and the typed ctx are specified once, in [validation.md › Pipeline validation and 422](./validation.md#pipeline-validation-and-422).
- **Only a malformed body, a failed body read or a multi-valued `Content-Type` is a 400.** A `Content-Type` that names more than one media type — a comma outside a quoted-string (RFC 9110 §5.6.4; `boundary="a,b"` is one value) — is the 400 `{ message: "Invalid Content-Type header: more than one media type." }` at the start of the read, before the default cap and the media-type classification: the header is a singleton field (RFC 9110 §8.3), and the platform's MIME extraction takes the last value, so a comma-joined value could otherwise be parsed as one media type while the platform reads another. The pipeline rethrows what is neither, so a `bodyLimit` mounted with `app.use()` before the routes, or in the route's Hono chain before the kernel, keeps its own 413 (it runs before the body read; only a 0.5 route's `middleware` option and a `Route.api` middleware class run too late, inside the pipeline after the read; the default body limit runs at the start of the read — [Default body limit](#default-body-limit)), and a body an earlier middleware read through Hono's readers is served from its cache, the route's own status still applying, as is a later `c.req.parseBody()`/`c.req.formData()` of a form body or `c.req.text()`/`c.req.json()` of a JSON body after the pipeline read it (the exceptions: an empty or whitespace-only JSON body is `{}` to the pipeline, while a later `c.req.json()` parses the cached original bytes and rejects, there being no JSON text; and on Hono 4.12.28 a later `c.req.parseBody()` of a FormData-only cache rejects, because it re-reads the FormData as bytes with a new boundary — 4.13.17 converts the cached FormData, and the pipeline writes its FormData back for it — validation.md has the detail); a body read off `c.req.raw` directly, and a multipart body a `c.req.text()` consumed, end as the generic 500 ([validation.md › Pipeline validation and 422 › Diagnostics](./validation.md#diagnostics-1)).
- **Still the 0.5 kernel:** the steps run inside `RequestKernel.handle`; 0.5 routes keep `processValidation`.

### Diagnostics
The 400 and 422 bodies, an empty body as `{}`, the **400** of a `Content-Type` with more than one media type (`{ message: "Invalid Content-Type header: more than one media type." }`, before the default cap and the classification), the **413** of the [default body limit](#default-body-limit) and of a `bodyLimit` mounted with `app.use()` before the kernel (the pipeline rethrows its `BodyLimitError`), the **400** of a body read that fails (a client abort or a truncated stream), the **500** of a body an earlier middleware read off `c.req.raw` directly or of a multipart body it read with `c.req.text()`, and the `TypeError` for a contract route with a request class: [validation.md › Pipeline validation and 422 › Diagnostics](./validation.md#diagnostics-1).

### Design (non-binding)
Fixed order, combining Nest and Laravel:

```
global middleware → throttle (429, mount) → auth guard (contract auth, 401)
→ route middleware → model binding (404) → validation (422) and policies (authorize, 403: scopes outer → inner, then the endpoint),
  in the order H8 #122 settles
→ interceptor (before) → handler → interceptor (after)
→ serialize (Resource / response schema) → exception filter
```

- **From the contract:** the auth guard, the rate limit and the policies are applied from the contract's capabilities
  ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)). The rate limit and
  the auth guard run today (`mount()`; auth since A2 [#120](https://github.com/Laratypes/Laratype/issues/120), after the
  rate limit because the limit wraps the kernel); the policies are planned → [#121](https://github.com/Laratypes/Laratype/issues/121). The guard is inside the kernel, so it runs before the route middleware, the bindings and validation, and a 401 never reveals whether a row exists. The limit is outside it, so it runs before the guard and before the kernel's body read: an unauthenticated flood costs no token check and no body parse ([Rate limiting](#rate-limiting) › Key, #319).
- **Parsing and validation (H3):** see [validation.md › Pipeline validation and 422](./validation.md#pipeline-validation-and-422). The pipeline builds the typed handler context.
- **Replaces:** `RequestKernel.pipeline` and `processValidation`. H3 [#106](https://github.com/Laratypes/Laratype/issues/106) runs the contract validation as their `request` step, so 0.5 routes keep `processValidation`; the auth guard is a typed middleware prepended by `mount()` (A2 [#120](https://github.com/Laratypes/Laratype/issues/120)), and the interceptor step is the H11 [#138](https://github.com/Laratypes/Laratype/issues/138) chain (merged, PR [#415](https://github.com/Laratypes/Laratype/pull/415) @ 23ef6862).

### Acceptance
[#106 Done when](https://github.com/Laratypes/Laratype/issues/106) · [#138 Done when](https://github.com/Laratypes/Laratype/issues/138)

---

## Default body limit

### Status
proposed: PR [#381](https://github.com/Laratypes/Laratype/pull/381) @ [554d82f](https://github.com/Laratypes/Laratype/commit/554d82f) (H44 [#341](https://github.com/Laratypes/Laratype/issues/341)). B30 [#410](https://github.com/Laratypes/Laratype/issues/410) takes the form media type from the same union classifier the parse uses and refuses a multi-valued `Content-Type` and a form media type name outside the leading media type before both, at [4109aef3](https://github.com/Laratypes/Laratype/commit/4109aef3).

### Public API
No new export. The caps live in `app/config/http.ts`, a config file like any other (K1 [#152](https://github.com/Laratypes/Laratype/issues/152)); code: [`request/bodyLimit.ts` @ 4109aef3](https://github.com/Laratypes/Laratype/blob/4109aef3b475ffe9ee518ab6156a29f4cdf71b46/packages/http/src/request/bodyLimit.ts).

```ts
// app/config/http.ts
import { defineConfig } from '@laratype/core'

export default defineConfig({
  bodyLimit: {
    json: 1_048_576,       // 1 MiB: application/json and application/*+json
    form: 1_048_576,       // 1 MiB: application/x-www-form-urlencoded
    multipart: 10_485_760, // 10 MiB: multipart/form-data
  },
})
```

A cap is a byte count or `false` (no cap for that media type); `bodyLimit: false` turns all three off. The file is optional: without it, the values above are the built-in defaults. A value that is not a finite number of 0 or more is ignored and the default stays, so a typo never removes a cap. The caps are read at the start of each body read, so a dev restart picks up a change. `examples/basic` has the file with the defaults.

### Invariants
- **Scope:** JSON (`application/json` and `application/*+json`, as [Pipeline validation](./validation.md#pipeline-validation-and-422) reads them), urlencoded (`application/x-www-form-urlencoded`) and multipart (`multipart/form-data`) bodies are capped. Any other media type is not read by the pipeline (`{}`), so it has no default cap; an app that reads one mounts its own `bodyLimit`.
- **A singleton `Content-Type`, and the form media type across the whole `hono` peer range.** `Content-Type` is a singleton field (RFC 9110 §8.3): a comma outside a quoted-string separates values, while a comma inside one (`boundary="a,b"`, RFC 9110 §5.6.4) is one value, a `\"` inside a quoted-string is an escaped quote, not its end, and an unterminated quoted-string quotes nothing, so a comma after its opening quote is a separator and the request is the same 400. A value holding more than one media type is the **400** `{ message: "Invalid Content-Type header: more than one media type." }` at the start of the read, before this classifier and the cap: the platform's MIME extraction takes the last value, so a comma-joined value could otherwise be parsed as one media type while the platform reads another. A form media type name outside the leading media type is the **400** `{ message: "Invalid Content-Type header: a form media type name outside the leading media type." }`, also before this classifier and the cap: that covers a name in a parameter, both names, and a name embedded in or suffixing the leading type (`x-multipart/form-data`, `application/x-www-form-urlencodedx`), because Bun's form parser picks the type by a substring search over the whole header (the leading type is the part before the first `;`, trimmed). `formMediaType` keeps its three arms as the helper's description of every spelling the `^4.8.0` peers and the 0.5 cap read as a form: 4.8.0–4.12.27 matches the value `headers.get("Content-Type")` returns with a case-sensitive `startsWith` (`Headers` strips leading/trailing HTTP whitespace, not U+00A0), 4.12.28+ takes `contentType.split(";")[0].trim().toLowerCase()` and compares it exactly to `multipart/form-data` / `application/x-www-form-urlencoded`, and the 0.5 default cap's lowercased `startsWith` also returns a form for a suffixed spelling the exact rules miss. Through `readBody`, however, the arms decide nothing for a suffixed or embedded form name: that header is the form-name 400 before the helper or the cap runs, so only a leading type that is exactly one of the two form names is read as a form and capped from that type. A spelling no arm accepts is `{}` and has no default cap, as on every peer.
- **Enforced at the start of the body read.** After the `Content-Type` 400s, `readBody` checks the cap before any reader touches the body, so an over-limit body is the 413 before parsing or validation. It is not a second Hono `bodyLimit` middleware: on Hono 4.9.6 two stacked `bodyLimit`s lose bytes of a multi-chunk body and the outer one answers its own 413 over the inner one's (4.13.17 buffers the body itself, but a second limiter would still read and buffer it twice). The counter here composes with an app's single `bodyLimit` (stacked Hono limits are re-checked in H48 [#382](https://github.com/Laratypes/Laratype/issues/382)).
- **Content-Length:** a declared length over the cap is refused without reading the stream. A missing or smaller Content-Length is not trusted: the stream is counted, and the read rejects when a delivered chunk takes the count over the cap. A chunk may hold the whole body, so the cap bounds what the pipeline accepts, not what the runtime had already delivered in that chunk; the streams' own read-ahead may pull a few chunks.
- **Cached bodies:** a body an earlier middleware read through Hono's byte or text readers is measured from Hono's cache when the cache holds its bytes: `text()`, `arrayBuffer()`, `blob()`, and `json()`, which caches the body's text. A form body a middleware parsed with `c.req.parseBody()` is measured too: on Hono 4.13.17 `parseBody()` reads through `c.req.arrayBuffer()`, so the cache holds the body's bytes next to the parsed FormData and an over-cap form gets the 413 (on 4.9.6 it cached only its parsed fields, so there its bytes are spent and it is not measured). A `c.req.formData()`'s `FormData`, and a `validator('form')` that reused a cached `FormData`, are not measured: the cache holds the parsed value, not its bytes, which are already spent (`validator('form')` that read the body itself went through `c.req.arrayBuffer()`, so those bytes are measured). A middleware that reads the **raw stream itself** (`c.req.raw`) before the pipeline is not covered by the default: it must mount its own Hono `bodyLimit` before it reads, because the bytes are gone and cannot be capped or rebuilt.
- **Override:** the default is a ceiling. `app/config/http.ts` raises, lowers or disables it. A route or app `bodyLimit` that runs before the pipeline's read (an `app.use()` one, or one in the route's Hono chain) keeps its own 413 when it is smaller; its larger cap cannot raise the default, which still applies at the read. A 0.5 route's `middleware` option and a `Route.api` middleware class run inside the pipeline, after the body read, so a `bodyLimit` there is too late (mount it with `app.use()` or in the Hono route chain).
- **413:** Hono `bodyLimit`'s own answer, status **413** with `Payload Too Large` as `text/plain`, on 0.5 and `Route.api` routes alike; the exception filter sends it as it is. A smaller route or app `bodyLimit` with a custom `onError` keeps its own body.
- **Buffering:** the cap bounds the bytes on the wire. A form or multipart body is still buffered about twice when parsed (the bytes, then the `FormData`), so peak memory is about 2× the cap; a large form route relies on the default or mounts its own `bodyLimit`.
- **Breaking change:** a JSON or form body over 1 MiB, or a multipart body over 10 MiB, now answers 413 even when the app mounts no `bodyLimit`. A form body an earlier middleware read with `c.req.formData()` is not measured, so it is not capped here; one it parsed with `c.req.parseBody()` is measured from the bytes Hono caches next to its FormData on 4.13.17, so an over-cap body gets the 413. Raise or disable the cap in `app/config/http.ts` (`bodyLimit`). An app that mounts its own Hono `bodyLimit` with a larger cap must raise or disable the config too: the default still applies at the read.

### Diagnostics
- The 413 is the one in [Pipeline validation and 422 › Diagnostics](./validation.md#diagnostics-1): no new message, body or header shape.
- A `Content-Type` with more than one media type is the **400** `{ message: "Invalid Content-Type header: more than one media type." }` at the start of the read, before the cap; the response is the pipeline's JSON 400, not the 413. It runs on every request `RequestKernel.handle` serves, before middleware and the handler, so it also applies to a GET with no body and to a route whose endpoint declares no body schema. Repeated `Content-Type` header lines are joined by `Headers.get` with `, ` and get the same 400, as does an empty element (a leading or trailing comma).
- A form media type name (`multipart/form-data` or `application/x-www-form-urlencoded`, case-insensitive) anywhere outside the leading media type is the **400** `{ message: "Invalid Content-Type header: a form media type name outside the leading media type." }`, before the cap and the parse. That covers a name in a parameter (quoted or not; a boundary included), a name embedded in or suffixed to another type (`x-multipart/form-data`), and both names in one header. The leading media type is the part before the first `;`, trimmed; it is the only one the pipeline parses and caps. The rule exists because Bun's `formData()` picks its parser by a case-sensitive substring search anywhere in the header, while the pipeline reads the leading type: without the 400, `multipart/form-data; boundary=x; t="application/x-www-form-urlencoded"` was capped as multipart and parsed as urlencoded, and a non-form leading type could be `{}` with no cap while the platform read fields.
- Runtime, invalid caps: no error. A value that is not a finite number of 0 or more is ignored and the built-in default stays; `false` disables only its own media type, `bodyLimit: false` all three.

### Example
Runtime tests: [`packages/http/__tests__/request/defaultBodyLimit.test.ts`](../../packages/http/__tests__/request/defaultBodyLimit.test.ts) (each media type over and under, the mixed-case form media types, the chunked and lying-Content-Length counters, a cached body, an app and a route `bodyLimit`, the config raise and `false`, 0.5 and `Route.api` routes, the multi-valued `Content-Type` 400 before the cap and without reading the body) and [`packages/http/__tests__/request/formMediaType.test.ts`](../../packages/http/__tests__/request/formMediaType.test.ts) (the form classifier across the `^4.8.0` peers, the comma-joined mixed-case values now refused with 400, and the quoted-comma, escaped-quote and whitespace spellings that stay one value).

### Non-goals
- No per-route raise above the default: a route that needs a larger body raises the app config; a per-route raise through `r.contract()` options is a possible follow-up (H48 [#382](https://github.com/Laratypes/Laratype/issues/382)).
- No cap for a media type the pipeline does not read, and no parsing of human sizes (`'1mb'`): bytes only.

### Acceptance
[#341 Done when](https://github.com/Laratypes/Laratype/issues/341)

---

## Response from the contract

### Status
proposed: PR [#404](https://github.com/Laratypes/Laratype/pull/404) @ 23875e4e (H4 [#107](https://github.com/Laratypes/Laratype/issues/107), H32 [#312](https://github.com/Laratypes/Laratype/issues/312)). `Jsonify` is in [contract.md › API type projection](./contract.md#api-type-projection).

### Public API
No new API: a `Route.api` route answers through `resolveContractResponse` ([`packages/http/src/response/contractResponse.ts`](../../packages/http/src/response/contractResponse.ts)), which `RequestKernel.handle` calls for a route with an endpoint.

### Invariants
- **Status:** the endpoint's, decided by the contract ([contract.md › Endpoint builder](./contract.md#endpoint-builder)): `204` when there is no response schema, `200` for `.response(schema)`, the given 2xx for `.response(schema, status)` and `.status(status)`. The method name (`store`, `destroy`) and the 0.5 status decorator play no part; [Router v2](#router-v2) rejects a decorator that disagrees when the routes are mounted.
- **No body:** an endpoint without a response schema, or with a 204 or 205, answers with no body, whatever the handler returns. `.status(202)` answers 202 with no body.
- **Body:** the handler's value, a `JsonResource` unwrapped, serialized once with `JSON.stringify` as `application/json`: a string is a JSON string, never HTML, and a `Date` is its ISO string, so the frontend reads `Jsonify<output>`. A value with no JSON text (`undefined`, a function, or a root `toJSON()` that returns `undefined`) is sent as `null`, so `Jsonify<T | undefined>` is `T | null` on the client (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)). The handler's own `Content-Type` and the other body headers (`Content-Length`, `Content-Encoding`, `Content-Disposition`, ... the `BODY_HEADERS` of [#272](https://github.com/Laratypes/Laratype/issues/272)) are dropped: they describe the body it built, not the one sent here. It is serialized before any of the handler's headers is set, so a value `JSON.stringify` throws on (a `bigint`, a cycle) is an unknown error, a 500 without them.
- **`Location` and `Content-Location`:** a `201 Created` keeps both of the handler's headers: `Location` names the created resource (RFC 9110 §15.3.2), `Content-Location` the resource its representation is about (§8.7). They are the exceptions to `REDIRECT_HEADERS` (`Location`, `Refresh`) and `BODY_HEADERS` (which holds `Content-Location`); every other status drops them, and so does an error response. An endpoint cannot declare a 3xx: a redirect is a 0.5 `Response` (below), which keeps its own `Location`. A cross-origin client can read either header only when the answer lists it in `Access-Control-Expose-Headers` (`app/config/cors.ts` › `exposeHeaders`, [CORS](#cors); the framework adds none).
- **0.5 `Response`:** a handler may return it for its headers and content. A 2xx status set on it must be the endpoint's, else the request ends in a 500. Its body headers (`Content-Type`, `Content-Length`, `Content-Location`, ...) and redirect headers (`Location`, `Refresh`) are dropped: the body is JSON or nothing, and the endpoint's status decides the resource headers above. A redirect, or a non-2xx status (a middleware answering 401 or 429 without calling `next`), is not the endpoint's success and is sent by the 0.5 response kernel as before. A redirect keeps the handler's other headers (`Set-Cookie`, cache, custom) and drops its body and redirect ones; a bodyless 304, 204 or 205 drops `Content-Type`; a 5xx runs the error header scrub ([Exceptions](#exceptions) › Error headers) while keeping the handler's status and body; and a status the platform cannot send (0, a string, a bigint, `NaN`, `Infinity`, a negative number, 99, 600, 1.5) is refused as the logged generic 500, never answered as 200 (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)). A decorator's 0 or `NaN` is refused the same way, never replaced by the method-name guess.
- **Dev-mode output validation:** unless `__PROD__` is true (or, without it, `NODE_ENV` is `production`), the handler's value is validated with the response schema before any header is set. The handler's value is sent, never the parsed one, in dev and in production alike, so the check also fails when the schema's output differs from the value as JSON (key order aside): a transform, or a key the schema strips (an entity's `passwordHash`), would put on the wire what `Jsonify<output>` doesn't say. The schema runs once (zod's `safeParseAsync`, so a side effect in a refinement or transform is not duplicated). A failure is the server's bug, so it answers the generic 500 of [Exceptions](#exceptions), with none of the handler's headers, and logs the reason, never a 422. Production skips the check and sends the handler's value as it is.
- **The response schema is not an output filter (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)).** In production the handler's value is sent as it is and never parsed by the response schema, so a key the schema would strip (an entity's `passwordHash`) still reaches the client when dev never ran a value that carries it (an optional, conditional or rarely populated field). The dev check above catches a stripped key only when the value carries it. Map to a DTO or a resource; do not expect zod's or Fastify's stripped output.
- **0.5 routes** (`Route.group`) keep their 0.5 response: an explicit `Response` status, then the status decorator (a present 0 or `NaN` is refused, never skipped), then the method-name guess (`ControllerMethodHttpStatusCode`), then 200. Its body is the [The 0.5 response](#the-05-response).

### Diagnostics
- `[@laratype/http] <route>: the handler answered status <n>, but the endpoint declares <status>: declare it on the endpoint (.response(schema, <n>) or .status(<n>))` (logged, 500)
- `[@laratype/http] the response status <value> cannot be sent: use an integer from 200 to 599` (a 0.5 `Response`'s explicit or decorator status, a present decorator `0` or `NaN` included; logged, generic 500. An explicit `null` status means unset, like `undefined`: the decorator or method-name guess, then 200)
- `[@laratype/http] the redirect status <value> cannot be sent: use 301, 302, 303, 307 or 308` (a 0.5 `Response`'s redirect status; logged, generic 500)
- `[@laratype/http] <route>: the handler's value does not match the endpoint's response schema (<path>: <messages>; ...)` (dev and test only; logged, 500). `(root)` names an issue without a path.
- `[@laratype/http] <route>: the endpoint's response schema changes the handler's value (a transform, or a key it strips), so the client's type would not match what is sent: return the schema's output` (dev and test only; logged, 500)

### Example
Tests: [`packages/http/__tests__/response/contractResponse.test.ts`](../../packages/http/__tests__/response/contractResponse.test.ts) (200, 201, 202, 204, 205, JSON, a middleware's 429, a redirect's kept headers, a 5xx `Response`'s scrub, a 201's `Location` and `Content-Location`, output validation, the schema running once) and [`edgeInputs.test.ts`](../../packages/http/__tests__/response/edgeInputs.test.ts) (a status the platform cannot send on an explicit, decorator (0 and `NaN`) or redirect status, a Proxy response, hostile header objects).

### Non-goals
- Resources v2 (H9 [#123](https://github.com/Laratypes/Laratype/issues/123)) wrap this step; interceptors (H11 [#138](https://github.com/Laratypes/Laratype/issues/138)) wrap the handler and hand their final value to it. Error responses are [Exceptions](#exceptions).

### Open questions
- Resolved: the frontend sees the response as `Jsonify<output>` (`Date` → `string`) ([#107](https://github.com/Laratypes/Laratype/issues/107), [#110](https://github.com/Laratypes/Laratype/issues/110)).

### Acceptance
[#107 Done when](https://github.com/Laratypes/Laratype/issues/107)

---

## The 0.5 response

### Status
proposed: PR [#404](https://github.com/Laratypes/Laratype/pull/404) @ 23875e4e (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)). Earlier: PR [#345](https://github.com/Laratypes/Laratype/pull/345) @ [04fb575](https://github.com/Laratypes/Laratype/commit/04fb575) ([#342](https://github.com/Laratypes/Laratype/issues/342), H45); string returns and `nosniff` merged @ e8633c9 (PR [#384](https://github.com/Laratypes/Laratype/pull/384)) ([#336](https://github.com/Laratypes/Laratype/issues/336), H41; breaking). The paginate page meta is [#339](https://github.com/Laratypes/Laratype/issues/339).

### Public API
No new API: a 0.5 route and an [ad-hoc route](#ad-hoc-routes) answer through `ResponseKernel.resolveResponse` ([`Response.ts` @ 738fd55](https://github.com/Laratypes/Laratype/blob/738fd55/packages/http/src/response/Response.ts#L105)), whose body comes from [`ResponseSupport.shouldBeJson()` @ 738fd55](https://github.com/Laratypes/Laratype/blob/738fd55/packages/http/src/supports/Response.ts#L109) and [`ResponseSerialization` @ 738fd55](https://github.com/Laratypes/Laratype/blob/738fd55/packages/http/src/supports/Response.ts#L116); a string has its own branch there (H41 [#336](https://github.com/Laratypes/Laratype/issues/336)): `text/plain; charset=utf-8` with `nosniff`, or the `Content-Type` the `Response` set, with `nosniff` too (`explicitContentType()`).

### Invariants
- **JSON detection:** `shouldBeJson()` reads the value's shape, never its `constructor` property: a model (a `dataSource` on the value's class, read from the prototype chain), a `JsonResource`, an array (a subclass included), or an object whose prototype is `Object.prototype` or `null` (the groups `parseBody({ dot: true })` builds from dot keys, and a test's `Object.create(null)`) — and, since a string is text (H41 [#336](https://github.com/Laratypes/Laratype/issues/336)), any other non-string value too (next bullet).
- **Content type:** a string is sent as `text/plain; charset=utf-8`, never `text/html`: a reflected `<script>` in a string body must not run (H41 [#336](https://github.com/Laratypes/Laratype/issues/336)). An explicit, non-blank `Content-Type` set on the `Response` is kept, so HTML is opt-in: `new Response(html).setContentType("text/html; charset=utf-8")` (a blank or non-string one is no type, so it takes the default and `nosniff`). No content (`null`, `undefined`) is an empty body. Every other value that serializes is JSON, sent as `application/json` whichever prototype it has (a `Date`, a class instance): `JSON.stringify` output is never labelled `text/html`. A value it throws on (a `bigint`, a cycle, a getter that throws) is the generic 500, with no body of the handler's (Diagnostics).
- **`nosniff`:** every JSON answer `resolveResponse` sends carries `X-Content-Type-Options: nosniff`, the error responses it sends included (a responsible `Exception`'s `toJson()`, the 5xx `{ message: "Server Error" }`), and so does every string answer, the default `text/plain` one and the one with the handler's own `Content-Type` (H41 [#336](https://github.com/Laratypes/Laratype/issues/336)) alike: an old browser must not sniff either as HTML. An answer built elsewhere does not: a contract error's `c.json` in `resolveException`, and the generic 500 of a non-`Error` throw ([Exceptions](#exceptions) › Non-`Error` throws), built by `ResponseKernel.boot()`'s `fetch` wrapper.
- **Status:** the 0.5 one, as for the [Response from the contract](#response-from-the-contract) › 0.5 routes: an explicit `Response` status, then the status decorator, then the method-name guess (`ControllerMethodHttpStatusCode`), then 200. A 204, 205 or 304 carries no body, no `Content-Type` and no `nosniff` (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)). A status the platform cannot send (0, a string, a bigint, `NaN`, `Infinity`, a negative number, 99, 600, 1.5) is a server bug: the logged generic 500, never an answer at 200; a redirect status other than 301, 302, 303, 307 and 308 is refused the same way. A decorator's 0 or `NaN` is refused the same way, never replaced by the method-name guess.
- **Headers:** the headers of a `Response` the handler returns are set, its `Content-Type` included, but the body sent is the one above: a JSON body is labelled `application/json`, and a string body `text/plain; charset=utf-8` unless the `Response` set a non-blank `Content-Type`, which is kept ([H41](https://github.com/Laratypes/Laratype/issues/336)). A redirect keeps the handler's other headers (`Set-Cookie`, cache, custom) and drops its body headers and `Location`/`Refresh`: the redirect names its own target (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)). A 5xx runs the same header scrub a thrown error gets ([Exceptions](#exceptions) › Error headers): a `Set-Cookie` that does not expire, the cache and validator headers and the body headers are dropped, `Cache-Control` is `no-store`, while the status and body stay the handler's.
- **Breaking change (H41 [#336](https://github.com/Laratypes/Laratype/issues/336)):** a string returned by a 0.5 controller method or a 0.5 route middleware is sent as `text/plain; charset=utf-8` with `nosniff`, not `text/html`. A rendered view or any other HTML string is sent as HTML only through an explicit `Content-Type` on a `Response`: `response(html).setContentType("text/html; charset=utf-8")` (`new Response(html).setContentType(...)`). Also breaking: an explicit `Content-Type` no longer overrides JSON for an object body, and an override of `getContentType()` in a class extending `ResponseSupport` is no longer honoured: every non-string value is JSON.

### Diagnostics
- a non-string value `JSON.stringify` throws on (a `bigint`, a cycle, a getter that throws): the generic **500** `{ message: "Server Error" }`, logged with the thrown error (`TypeError: Do not know how to serialize a BigInt`, `TypeError: Converting circular structure to JSON` for the two named), never the value's own body.
- a status the platform cannot send, or a redirect status outside 301, 302, 303, 307 and 308: the logged generic **500** `{ message: "Server Error" }` (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)).
- `[@laratype/http] the response status <value> cannot be sent: use an integer from 200 to 599` (logged, 500)
- `[@laratype/http] the redirect status <value> cannot be sent: use 301, 302, 303, 307 or 308` (logged, 500)

No TypeScript error.

### Example
```ts
Route.api(appApi, (r) => [
  r.contract(health, HealthController),
  // POST /profile with the urlencoded body `profile.name=a`: the group `parseBody()` built is sent as JSON
  r.post('/profile', (req) => req.input('profile')),
])
```

Tests: [`packages/http/__tests__/response/jsonDetection.test.ts`](../../packages/http/__tests__/response/jsonDetection.test.ts) (a plain object, an array, an `Array` subclass, `parseBody()`'s null-prototype objects, an own `constructor` key, a value of another prototype, a model, a `JsonResource`, `nosniff`, and the urlencoded body group of an ad-hoc route), [`plainText.test.ts`](../../packages/http/__tests__/response/plainText.test.ts) (a string from an ad-hoc route, a 0.5 controller and 0.5 middleware as `text/plain` with `nosniff`, the `text/html` opt-in, JSON objects, and a `Response`'s status and headers) and [`edgeInputs.test.ts`](../../packages/http/__tests__/response/edgeInputs.test.ts) (a status the platform cannot send on an explicit, decorator or redirect status, a valid 5xx `Response`'s header scrub, a Proxy response, mixed-case names, a very long value, CR LF, control characters, a prototype and a non-enumerable key, `__proto__`).

### Non-goals
- The paginate page meta: [#339](https://github.com/Laratypes/Laratype/issues/339).
- A contract route: [Response from the contract](#response-from-the-contract) already sends `application/json`.

### Open questions
- None recorded.

### Acceptance
[#342 Done when](https://github.com/Laratypes/Laratype/issues/342)

---

## Exceptions

### Status
proposed: PR [#404](https://github.com/Laratypes/Laratype/pull/404) @ 23875e4e (H29 [#295](https://github.com/Laratypes/Laratype/issues/295), X3 [#392](https://github.com/Laratypes/Laratype/issues/392), H32 [#312](https://github.com/Laratypes/Laratype/issues/312)). Earlier: PR [#388](https://github.com/Laratypes/Laratype/pull/388) @ f04379c; the filter is PR #307 @ 1d24eb0 (H5 [#108](https://github.com/Laratypes/Laratype/issues/108)); the error handling it keeps is merged ([#267](https://github.com/Laratypes/Laratype/issues/267) H20, [#272](https://github.com/Laratypes/Laratype/issues/272) H23, [#275](https://github.com/Laratypes/Laratype/issues/275) H24).

### Public API
[`Response.ts` @ 1d24eb0](https://github.com/Laratypes/Laratype/blob/1d24eb0/packages/http/src/response/Response.ts) · [`isContractError` @ 1d24eb0](https://github.com/Laratypes/Laratype/blob/1d24eb0/packages/contract/src/errors.ts) · [`isException` @ 1d24eb0](https://github.com/Laratypes/Laratype/blob/1d24eb0/packages/support/src/exception/Exception.ts)

```ts
// @laratype/http: the exception filter, the Hono onError handler that ResponseKernel.boot() registers
class ResponseKernel {
  resolveException(err: Error | Exception, c: Context): Response | Promise<Response>;
}
// @laratype/contract
export const isContractError: (value: unknown) => value is ContractError<number, string, object>;
// @laratype/support
export const isException: (value: unknown) => value is Exception;
```

### Invariants
- **Contract errors:** a thrown `ContractError`, from `defineError` or the `errors` catalog, at any depth, answers its own status with the JSON body `{ code, ...body }`, whatever the route's or controller's status. A declared 5xx keeps its body too: it is the error the contract declares. A body's own top-level `toJSON` is dropped: JSON serialization would call it, and it could leave out the declared `code`. A contract error is an expected answer, so it is not logged.
- **By brand:** the filter tells a contract error with `isContractError` and an `Exception` with `isException`, by a `Symbol.for` brand, not `instanceof`, so one from another copy of `@laratype/contract` or `@laratype/support` counts. `isContractError` also requires a 400-599 integer `status`, a string `code` and a non-array object `body` without its own `code`: a contract error whose fields were changed after it was created so that they no longer fit the wire format is an unknown error. `isException` also requires the public methods of an `Exception`: `getErrorCode()`, `getHttpCode()`, `canResponsible()` and `toJson()`.
- **Framework errors:** the catalog's 401, 403, 404, 422 and 429 go out as `{ code, message }` (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `TOO_MANY_REQUESTS`) and `{ code: "VALIDATION_ERROR", message, errors }`. The 0.5 `NotFoundException` and `UnauthorizedException` send the same `{ code, message }` shape.
- **Unknown errors:** any error that is not a contract error, a responsible `Exception` or an HTTP error answers 500, whatever the route's or controller's status. Every 5xx other than a contract error, including a responsible `Exception` with a 5xx status (`InternalException`) and a 5xx `HTTPException`, keeps its status but carries only `{ message: "Server Error" }`. A responsible 4xx `Exception` keeps its body, and a 4xx Hono `HTTPException` keeps its response, with the headers middleware set (CORS, Vary). A responsible `Exception`'s status is read through `getHttpCode()` and must be an integer from 200 to 599: a string (`"503"`), a bigint (`503n`), `NaN`, `Infinity`, a negative number, 99, 600 or 1.5 is refused as the logged generic 500, never answered as 200 (X3 [#392](https://github.com/Laratypes/Laratype/issues/392), H32 [#312](https://github.com/Laratypes/Laratype/issues/312)).
- **HTTP errors:** an HTTP error is told by its shape: an integer `status` from 400 to 599 and a `getResponse()` that returns a fetch `Response` whose status is from 400 to 599 too; anything else is an unknown error. Its 4xx or 5xx is decided on the status actually sent, the response's ([#272](https://github.com/Laratypes/Laratype/issues/272), H23). A 3xx response from such an error, a login redirect for example, is intended to be one of those unknown errors: it answers the logged generic 500 ([#295](https://github.com/Laratypes/Laratype/issues/295), H29).
- **Error headers** ([#272](https://github.com/Laratypes/Laratype/issues/272), H23; [#295](https://github.com/Laratypes/Laratype/issues/295), H29): an error response, a contract error's included, drops the `ETag`, `Last-Modified`, `Expires`, `Age`, `Surrogate-Key`, `Cache-Tag`, `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`, `Surrogate-Control`, `X-Accel-Expires`, `Vercel-CDN-Cache-Control`, `Netlify-CDN-Cache-Control`, `Edge-Control` and the server offload headers (`X-Accel-Redirect` for nginx, `X-Sendfile` and `X-Sendfile-Temporary` for Apache, `X-Sendfile2` and `X-Lighttpd-Send-File` for lighttpd, `X-LiteSpeed-Location` for LiteSpeed, `X-Reproxy-URL` for reproxy, which would make the server send a file in place of the error) set before the throw or on an HTTP error's own response, and has `Cache-Control: no-store`. A `Set-Cookie` is dropped unless it expires its cookie: a `Max-Age` 0 or less when there is one, or else every `Expires` a strict IMF-fixdate (`Www, DD Mmm YYYY HH:MM:SS GMT`) in the past. Attribute names are case-insensitive, every value is read on its own (`Headers.getSetCookie()`, never a comma-joined header), and an attribute that is malformed (a `Max-Age` that is not an integer, an `Expires` that is not an IMF-fixdate) does not expire the cookie. The headers set before the throw that describe a body or redirect, `Content-Type`, `Content-Length`, `Content-Encoding`, `Content-Range`, `Content-Disposition`, `Content-Location`, `Content-Digest`, `Repr-Digest`, `Digest`, `Content-MD5`, `Location`, `Refresh`, `Transfer-Encoding` and `Trailer`, are dropped too, whether set with `c.header()` or on a response finalized before the throw (a middleware that throws after `await next()`). The other headers set before the throw (CORS, Vary) stay. The same scrub runs in an outermost middleware, so a dropped header a middleware sets after `await next()` is dropped too (a session commit's `Set-Cookie`, `etag()`'s validator, an offload header a proxy would honour), and a middleware cannot turn the error's answer into a success: a non-error status, `etag()`'s 304 on a matching `If-None-Match`, is replaced by the error's own response. A 4xx HTTP error keeps the other headers of its own response, its own `WWW-Authenticate` and `Retry-After` winning over a `c.header()` one set before the throw, and every `WWW-Authenticate` challenge is kept; a 5xx one keeps only `Retry-After` and `WWW-Authenticate` from it. The body a throw drops, a finalized response's and a 5xx `HTTPException`'s own, is cancelled. A JSON answer that goes through the 0.5 response path carries `X-Content-Type-Options: nosniff` ([The 0.5 response](#the-05-response)). The scrub is for a throw (`c.error`): a 4xx a handler or middleware returns, and Hono's `notFound` 404, keep the headers set earlier, as in [#272](https://github.com/Laratypes/Laratype/issues/272). A 5xx a handler returns as a 0.5 `Response` runs the same scrub before its body is built, while its status and body stay the handler's (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)).
- **Non-`Error` throws:** Hono's error handler only sees an `Error`. A `throw "x"`, `throw {}` or a rejection with a non-`Error`, from a controller or any middleware, leaves the app's `fetch`, which `ResponseKernel.boot()` wraps: it answers the generic 500 with `Cache-Control: no-store` and logs the value, on every adapter. That response doesn't carry the headers middleware set.
- **Unserializable body:** a contract error whose body JSON can't hold (a `BigInt`, a cycle, a getter that throws) answers the generic 500 with `Cache-Control: no-store`, and is logged with the serialization failure. A responsible `Exception`'s `toJson()` that throws, or a body its JSON cannot hold, keeps the exception's own status with the generic body `{ message: "Server Error" }`, and is logged with the error and the failure (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)): the filter's own failure never turns a 4xx into a 500.
- **A rethrown `c.error`:** a middleware that throws `c.error` after `await next()` for an `HTTPException` that carries its own `Response` gets the generic 500, not the error's status: the first answer already sent that response, so its body is disturbed when the filter reads it again, and the second failure is an unknown error. The first answer's body is not leaked. An `HTTPException` built from a message only is answered again as its own status (H29 [#295](https://github.com/Laratypes/Laratype/issues/295), H32 [#312](https://github.com/Laratypes/Laratype/issues/312)).
- **Logs:** `resolveException` logs each error once (`console.error`) when it is reportable or ends as a 5xx, contract errors aside. The `Exception` constructor logs nothing: constructing an exception has no side effects, so a thrown reportable one is reported once ([#273](https://github.com/Laratypes/Laratype/issues/273)).
- **0.5 request classes:** a 0.5 request class's `rules()` schema must be a Standard Schema: zod 4.6.6+ (run once by the contract's `validate()`, async refinements included), valibot, .... Only invalid input answers 422 (`ValidationException`, `{ code: "VALIDATION", message, errors }`), listing the validator's issues as `errors`, each cut to `{ path, message }` for every library, zod included (H3 [#106](https://github.com/Laratypes/Laratype/issues/106)); a default message that ends with the word `received` and the submitted value (valibot `... but received "x"` and `Invalid email: Received "x"`) loses that tail, and zod 4's unrecognized keys after the first `": "` are cut. Server internals never reach the 422. A request class that doesn't override `rules()` is not validated: the default `rules()` carries a `Symbol.for("laratype.http.defaultRules")` brand, so two copies of `@laratype/http` agree. An error from `rules()`, or one thrown inside the schema (an `AggregateError` even with its own `errors` field, a nested parse's `ZodError`), is an unknown error, a generic 500 ([#275](https://github.com/Laratypes/Laratype/issues/275), H24). A `Route.api` route answers invalid input with the catalog 422 instead ([validation.md › Pipeline validation and 422](./validation.md#pipeline-validation-and-422)).

- **Wire format (decided by CL2 [#110](https://github.com/Laratypes/Laratype/issues/110)):** the client narrows an error by its `code` ([client.md › Result union](./client.md#result-union)). The unknown-error 500 has no `code`, so the client classifies it as unexpected.

### Diagnostics
- The unknown-error body, and that of every non-contract 5xx: `{ "message": "Server Error" }`, with `Cache-Control: no-store`.
- A contract error answers its own status with `{ code, ...body }`; the framework errors are the codes listed in Invariants (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `TOO_MANY_REQUESTS`, `VALIDATION_ERROR`).
- A responsible `Exception`'s `toJson()` that throws, or a body JSON cannot hold: the generic body at the exception's own status, logged with the error and the failure (Invariants › Unserializable body).
- A responsible `Exception` whose `getHttpCode()` is not an integer from 200 to 599, and a rethrown `c.error` whose `HTTPException` carries its own `Response`: the logged generic 500, never 200 (Invariants › Unknown errors, A rethrown `c.error`).
- A 401 that clears a cookie answers with the clearing `Set-Cookie` (`Max-Age=0` or an `Expires` in the past), and without a fresh one (Invariants › Error headers).
- Logs: one `console.error` per reportable error or 5xx, contract errors aside (Invariants › Logs).

### Example
Runtime tests in `packages/http/__tests__/response/`: [`exceptionFilter.test.ts`](../../packages/http/__tests__/response/exceptionFilter.test.ts), `unknownError.test.ts`, `errorHeaders.test.ts`, `validationError.test.ts`, `undeclaredError.test.ts` and [`edgeInputs.test.ts`](../../packages/http/__tests__/response/edgeInputs.test.ts) (a status the platform cannot send, throwing getters, a Proxy response, hostile header objects).

### Non-goals
- Keeping a fresh `Set-Cookie` on an error response, as session-id rotation needs: an error keeps only the cookies that expire one (H29 [#295](https://github.com/Laratypes/Laratype/issues/295)).
- No dev-mode error detail view in M1.
- No `fail()`, `ErrorReply` or error branch of `Result<E>` ([Controller typing](#controller-typing-ctx-and-controllerof)): errors are thrown. None of them exists in package code.
- The undeclared-error check in dev and test is a separate section: [Undeclared-error check](#undeclared-error-check) (X3 [#157](https://github.com/Laratypes/Laratype/issues/157)).

### Open questions
- None recorded.

### Acceptance
[#108 Done when](https://github.com/Laratypes/Laratype/issues/108)

---

## Typed middleware

### Status
merged @ 112ec823 (PR [#352](https://github.com/Laratypes/Laratype/pull/352), H6 [#117](https://github.com/Laratypes/Laratype/issues/117), M2). The 0.5 `Middleware` class
stays for 0.5 routes; `Route.api` builders take both it and the typed middleware. `MiddlewareHandler` stays the 0.5
`(request, res, next)` type; the typed handler is `TypedMiddlewareHandler`, so the two names don't shadow each other.

### Public API
[`packages/http/src/middleware/defineMiddleware.ts`](https://github.com/Laratypes/Laratype/blob/fd6945817092f47f7af620409c1354f97e17a3b5/packages/http/src/middleware/defineMiddleware.ts) ·
[`routing/api/types.ts`](https://github.com/Laratypes/Laratype/blob/fd6945817092f47f7af620409c1354f97e17a3b5/packages/http/src/routing/api/types.ts)

```ts
function defineMiddleware<Ext extends object = {}>(handle: TypedMiddlewareHandler<Ext>): TypedMiddleware<Ext>;
type TypedMiddlewareHandler<Ext extends object = {}> = (
  request: Request,                                  // the 0.5 request class: headers, params, body
  // `ext` is required when Ext has a required key; optional when every key is optional (or Ext is `{}`)
  next: (...args: {} extends Ext ? [ext?: Ext] : [ext: Ext]) => Promise<unknown>,
) => unknown | Promise<unknown>;
interface TypedMiddleware<Ext extends object = {}> {
  readonly __ext?: Ext;                               // phantom: the context keys it adds
  readonly handle: TypedMiddlewareHandler<Ext>;
}
function isTypedMiddleware(value: unknown): value is TypedMiddleware<any>;
type MiddlewareItem = MiddlewareClass | TypedMiddleware<any>;   // what r.middleware() takes

interface ApiRouteBuilder<A, M extends readonly MiddlewareItem[] = []> {
  middleware<const W extends readonly MiddlewareItem[]>(...middleware: W): ApiRouteBuilder<A, [...M, ...W]>;
  withoutMiddleware<const W extends readonly MiddlewareItem[]>(...middleware: W): ApiRouteBuilder<A, WithoutMiddleware<M, W>>;
  // RouteProof runs with ExtOf<M>, the extensions M adds merged in order (last wins; params one level deep)
  contract<C, K extends ControllerClass, P extends PolicyClass | undefined = undefined>(
    contract: C,
    controller: K & RouteProof<A, C, InstanceType<K>, { readonly policy: NoInfer<P> }, ExtOf<M>>,
    options?: ContractRouteOptions<NoInfer<C>, P>): MountedContract<C>;
}

interface EndpointRouteBuilder {                       // the r of an endpoints callback: 0.5 classes only
  middleware(...middleware: MiddlewareClass[]): EndpointRouteBuilder;
  withoutMiddleware(...middleware: MiddlewareClass[]): EndpointRouteBuilder;
}
```

`ExtOf<M>` is exported too: it is the extensions of `M` merged in order, as the runtime merges them (Invariants).

### Invariants
- **Definition:** `defineMiddleware<Ext>((request, next) => next(ext))` declares the context keys it adds. It runs after
  the 0.5 request body is parsed, but before contract input is validated and the handler ctx is built: `request` is the
  0.5 request object (a contract route's has `endpoint`), and `next(ext)` merges `ext` into the handler ctx and
  continues the pipeline. `next` takes `ext` as a required argument when `Ext` has a required key, and as an optional one
  when every key is optional or `Ext` is `{}`; a call without it adds nothing at runtime. A middleware that does not
  call `next()` short-circuits: its value is the handler's value (a 0.5 `response()` keeps its status, see
  [Response from the contract](#response-from-the-contract)). A second `next()` (or a concurrent one) rejects with the
  message under Diagnostics, naming the middleware: each middleware runs the rest of the pipeline at most once.
- **The merge:** own enumerable keys of `ext`, string and symbol keys alike, in middleware order, so a later middleware
  wins a key it also adds. Each key is defined as an own enumerable data property, so an own `__proto__` key is a ctx
  field and never swaps the ctx prototype. A `params` key is merged one level deep, as `Ctx` merges it, so an extension
  adds a param next to the path params instead of replacing them. The ctx's `endpoint` field is pinned after the merge:
  it is still the route's endpoint, non-writable and non-enumerable ([Controller typing](#controller-typing-ctx-and-controllerof)).
  An extension is an object of context keys, applied as written: a function (or any other non-object) is rejected on
  purpose. A `next(ext)` whose `ext` is not an object fails the request with the message under Diagnostics, naming the
  middleware. The own enumerable keys and their values are snapshotted at `next()`, so mutating the object afterward
  (or a Proxy that changes its `ownKeys`) does not change the ctx.
- **Reserved keys:** a contract route's ctx keeps the endpoint's validated `query` and `body` and its `endpoint`, so an
  extension under one of those keys fails the request before the handler, with the message under Diagnostics naming the
  middleware and the key. `params` is an allowed extension key (merged one level deep). A `TypedMiddleware` whose `Ext`
  has a reserved key fails the route proof at `r.contract()` the same way, whatever its handlers declare.
- **On a route without a contract** (an ad-hoc route), the extensions are applied onto the 0.5 request object the handler
  gets, so a key that is a member of the request (own or inherited: a method such as `param`, or a data field such as
  `requestCtx`; `key in request`) fails the request before the handler the same way: it would replace the member. A
  contract route's ctx is a new object, so its extension keys only clash with the reserved ones above.
- **Accumulation:** `r.middleware(...)` returns a new builder, so the extensions accumulate on that builder in call
  order, and the contract it mounts gets all of them: `r.middleware(auth).middleware(audit).contract(posts, PostController)`
  extends every handler of `posts`. A builder mounted at two levels carries its extensions to both, as
  [Router v2](#router-v2) says for the 0.5 `web` builder, so `const web = r.middleware(auth); [web.scope('<folder>', ...),
  web.contract(posts, PostController)]` proves `posts` against `auth`'s extensions. A scope's middleware is merged into
  its routes at runtime, but it is not a type-level level: a contract mounted by another builder is not proven against
  it (mount that contract from the shared builder too). `ExtOf<M>` (exported) merges the extensions of `M` in order, as
  the runtime merges them: a later middleware's key replaces an earlier one's type, and `params` merges one level deep,
  so the proof checks each handler against the value the runtime keeps. A key a middleware declares `never` fails
  `r.contract()` with
  `` <c>.<e>: middleware extension '<key>' is `never` (declared `never`) ``, even when no handler declares the key: no
  value can be given, and a handler would read it as any type. A nested key is named by its path (`user.id`,
  `params.post`). The walk follows nested objects without a fixed depth cap (TypeScript's own instantiation limit still
  applies); it stops at a type it already saw on the same path, so a self-referencing extension type (`{ node: Node }`
  with `interface Node { next: Node }`) terminates. A key typed only `undefined` is not a conflict (an extension slot may
  be `undefined`), and a function- or array-valued key is compared as the later value's type like any other key; the walk
  does not descend into it. The route proof (`Provided`) checks each handler against the merged extensions: a handler that
  requires a key no middleware adds, or a value of another type than the later middleware's, is the diagnosis of
  [Route proof at r.contract()](#route-proof-at-rcontract).
- **Last-wins ([#349](https://github.com/Laratypes/Laratype/issues/349)):** a later middleware that adds a key replaces
  the earlier type, as it replaces the value; a handler that needs the earlier type fails `r.contract()` with
  `` <c>.<e>: `<key>` provided by the route does not match the handler (missing .bind()?) ``. `params` is the one key
  merged (one level deep) instead of replaced.
- **0.5 middleware keeps working:** a `typeof Middleware` class and a `TypedMiddleware` value share `r.middleware(...)`
  and run in route order, each once (duplicates removed, as [Router v2](#router-v2) says). The registry's
  `RouteEntry.middleware` keeps both, in order. `sauf route:list` names a typed middleware by its handle's function name;
  an anonymous handle shows as `middleware`, so name it: `defineMiddleware(function audit(...) {...})`.
- **`withoutMiddleware`:** drops every middleware of the arguments from what the builder accumulated, by identity (the
  0.5 semantics), and returns a new builder: `r.middleware(Audit).withoutMiddleware(Audit)`. A dropped typed
  middleware's extension leaves the proof with it. Two distinct middleware of structurally identical types (two
  `defineMiddleware<{}>` values) are one type, so the type side drops both: the runtime drops only the value.
- **Endpoint callbacks take 0.5 classes.** `r.contract(c, Ctrl, { endpoints: { destroy: (r) => r.middleware(Audit) } })`
  still mounts 0.5 middleware for one endpoint ([Router v2](#router-v2)). A `defineMiddleware()` value there is not
  proven: the callback type rejects it. The limitation is type-only: if the types are bypassed, the runtime still merges
  its extension into the ctx, but the route proof cannot see it (see Non-goals), so a handler could not declare the key.
  The shape of the map is the one [#117](https://github.com/Laratypes/Laratype/issues/117) settled; only the typed
  extension of a callback entry is left out.
- **API auth is not written with `r.middleware()`.** A contract's resolved `auth` is enforced by `Route.api` at
  `mount()` with `auth()` from `@laratype/auth`, before the route middleware ([auth.md › Authentication from the
  contract](./auth.md#authentication-from-the-contract), A2 [#120](https://github.com/Laratypes/Laratype/issues/120)).
  The exported `auth()` is the same typed middleware for an ad-hoc route
  (`r.middleware(auth('api')).get(...)`) or a manual `RequestKernel.handle({ middleware: [auth('api')] })`. Rate limits
  are enforced by `mount()` too ([Rate limiting](#rate-limiting)).
- **Ad-hoc routes:** `r.middleware(traced).get('/health', handler)` merges the extension into the 0.5 request the ad-hoc
  handler gets ([Ad-hoc routes](#ad-hoc-routes)); a 0.5 route's own options take no typed middleware.

### Diagnostics
Runtime `Error`s, prefixed `[@laratype/http] `:
- `Route.api: r.middleware(): <value> is not middleware (a 0.5 Middleware class or defineMiddleware(...))` (at
  `Route.api`, for a value that is not a constructable function or a `defineMiddleware()` value; an arrow function is
  not a class)
- `typed middleware <name> passed <typeof> to next(): pass an object of context keys, or call next()` (a `TypeError` for
  the request; `<name>` is the handle's function name, or `middleware`)
- `typed middleware <name> passed <key> to next(): <key> is reserved on a contract route (the validated query and body, and the endpoint)`
  (a `TypeError`: `query`, `body` and `endpoint` are the route's)
- `typed middleware <name> passed <key> to next(): it is a member of the 0.5 request, and the extension would replace it`
  (a `TypeError` on a route without a contract: a method or a data field of the 0.5 request, own or inherited)
- `typed middleware <name> called next() more than once` (a `TypeError`: the rest of the pipeline runs at most once per
  middleware)
- `defineMiddleware(): expected a function (request, next), got <typeof>` (a `TypeError`)

Type-level, at `r.contract()`:
- the route proof's existing diagnosis: `` <c>.<e>: handler requires `<key>`, route does not provide it (add
  middleware / .bind()) ``
- `` <c>.<e>: middleware extension '<key>' is `never` (declared `never`) ``: a middleware declares the key `never`, so
  the handler could not receive a value. `<key>` is the path of a nested object key (`params.post`, `user.id`); a key
  typed only `undefined` is not a conflict (Invariants).
- `` <c>.<e>: middleware extension '<key>' is reserved on a contract route (the validated query and body, and the endpoint) ``:
  a `TypedMiddleware`'s `Ext` has `query`, `body` or `endpoint`, which the route keeps; the extension is refused at
  runtime, whatever the handler declares.

### Example
```ts
const audit = defineMiddleware((request, next) => {
  console.log(request.method(), request.path())
  return next()
})
const auth = defineMiddleware<{ user: User }>(async (request, next) => next({ user: await User.fromToken(request.bearerToken()) }))

export class PostController extends Controller {
  async index() { return [] }
  async destroy({ user }: Ctx<typeof posts.destroy, { user: User }>) { void user }   // provided by auth()
}

Route.api(appApi, (r) => [
  r.middleware(audit).scope('admin', { policy: AdminPolicy }),
  r.middleware(auth).contract(posts, PostController),                    // both handlers see `user`
  r.middleware(audit).withoutMiddleware(audit).contract(health, HealthController),
])
```

Tests: [`packages/http/__tests__/routing/typedMiddleware.test.ts`](../../packages/http/__tests__/routing/typedMiddleware.test.ts)
(requests through `app.request()`: a later middleware wins a key, a symbol key, an own `__proto__` key, the reserved
`query`/`body`/`endpoint` keys, the request-method shadow on an ad-hoc route, and a second or concurrent `next()`) and
[`typedMiddleware.test-d.ts`](../../packages/http/__tests__/routing/typedMiddleware.test-d.ts) (the accumulated ctx, the
0.5 `MiddlewareHandler`, last-wins at the top level, four keys deep and in `params`, a declared `never` at the top level
and nested, an `undefined`-only key, a self-referencing extension type, the reserved keys, and the missing middleware at
`r.contract()`).

### Non-goals
- **No typed middleware in `endpoints` callbacks yet** (0.5 classes only). TypeScript checks the controller parameter of
  `r.contract()` before it infers the options argument, so the extensions of the callbacks cannot join the proof: the
  handler is checked with `{}` for that endpoint while the runtime still merges the extension. The map's shape is
  settled; only its typed extension is left out. Route-level `r.middleware()` covers the same handlers when the
  extension is shared by the contract.
- No per-endpoint `withoutMiddleware` of an inherited route middleware: an endpoint callback starts from an empty stack.
  Route middleware is removed on the builder, before `.contract()`.
- No global middleware registry: every route mounts its middleware explicitly, and no `withoutMiddleware` names a class
  it never had.
- No async factory for a middleware: `defineMiddleware()` takes the handler itself.

### Open questions
- None recorded.

### Acceptance
[#117 Done when](https://github.com/Laratypes/Laratype/issues/117)

---

## Model binding

### Status
proposed: PR [#379](https://github.com/Laratypes/Laratype/pull/379) @ 1578b639 (H7 [#118](https://github.com/Laratypes/Laratype/issues/118), M2). Explicit `r.bind()` for `Route.api` routes. The 0.5 `Route.model`, `Route.bind`, `explicitModelBinding` and `ModelBindingRegistry.paramModelMap` paths are unchanged: `Route.api` routes keep `modelBinding: false` and get `r.bind()` only. Implicit binding is [#163](https://github.com/Laratypes/Laratype/issues/163) (H14), planned.

### Public API
[`packages/http/src/routing/api/bindings.ts`](https://github.com/Laratypes/Laratype/blob/1578b639/packages/http/src/routing/api/bindings.ts) ·
[`proof.ts`](https://github.com/Laratypes/Laratype/blob/1578b639/packages/http/src/routing/api/proof.ts) ·
[`types.ts`](https://github.com/Laratypes/Laratype/blob/1578b639/packages/http/src/routing/api/types.ts) ·
[`packages/database/src/eloquent/BindableModel.ts`](https://github.com/Laratypes/Laratype/blob/1578b639/packages/database/src/eloquent/BindableModel.ts)

```ts
// @laratype/http: the static side of a model class, structural (the same shape as @laratype/database BindableModel)
interface BindableModelClass<M extends object = object> {
  new (...args: any[]): M;
  readonly primaryKey: string;
  readonly routeKeyName?: string;
  findByRouteKey(key: string): Promise<M | null | undefined>;
}
type Binder = BindableModelClass | ModelFunction | Resolver;
// internal members of Binder: a callable with the statics is a model, and a resolver must not carry the lookup
type ModelFunction = ((raw: string) => unknown) & { readonly primaryKey: string; findByRouteKey(key: string): unknown };
type Resolver = ((raw: string) => unknown) & { readonly findByRouteKey?: never };
type Bindings = Readonly<Record<string, Binder>>;
// internal to the proof (not exported): how a binder's value is typed
type Bound<B>;                       // BindableModelClass: InstanceType<B>; a callable with its statics: the lookup result; a resolver: NonNullable<Awaited<ReturnType<B>>> (Date included)
type BoundParams<P, B>;              // keyof B & keyof P, plus `| undefined` for an optional path param
type MergedBindings<B, NB>;          // Omit<B, keyof NB> & NB: a later bind replaces the key it binds again

interface ApiRouteBuilder<A, M extends readonly MiddlewareItem[] = [], B extends Record<string, Binder> = {}> {
  bind<const NB extends Record<string, Binder>>(bindings: NB): ApiRouteBuilder<A, M, MergedBindings<B, NB>>;   // a key bound again is replaced
  contract<C extends ApiTreeContract<A> | ApiTreeNode<A>, K extends ControllerClass, P extends PolicyClass | undefined = undefined>(
    contract: C, controller: K & RouteProof<A, C, InstanceType<K>, { readonly policy: NoInfer<P> }, ExtOf<M>, B>,
    options?: ContractRouteOptions<NoInfer<C>, P>): MountedContract<C, B>;
  scope<D extends ApiScopeDir<A>>(dir: D, options: ScopeRouteOptions): MountedScope<D, B>;
}
interface MountedContract<C extends object = AnyContract, B extends Record<string, Binder> = Bindings> {
  readonly bindings: B;          // the r.bind() map of the builder, typed for the scope-binding check
}
interface MountedScope<D extends string = string, B extends Record<string, Binder> = Bindings> {
  readonly bindings: B;          // the bindings for the contracts under the folder
}

// @laratype/database, type-only
interface BindableModel<M extends object = object> {
  new (...args: any[]): M;
  readonly primaryKey: string;
  readonly routeKeyName?: string;
  findByRouteKey(key: string): Promise<M | null | undefined>;
}
```

### Invariants
- **Explicit.** `r.bind({ user: User })` is called on the `r` of `Route.api`. Its keys are checked against every path param of the contract it is mounted with, the params of parent `[x]` folders included ([contract.md › Contract folder tree](./contract.md#contract-folder-tree)): a key that is not a path param of any endpoint is a compile error at `r.contract()` and a runtime error at `Route.api` (a scope's keys are checked against the endpoints under its folder). A later `.bind()` wins a key it binds again, and the map is a frozen copy: mutating the original object after `Route.api` changes no route.
- **Values.** A model class is the `BindableModel` static side: the lookup is `Model.findByRouteKey(raw)`, and `routeKeyName` defaults to `primaryKey` ([database.md › BindableModel](./database.md#bindablemodel)). A resolver is called with the raw path param. The router never parses a route key: converting a numeric id or a UUID is the model's or the resolver's job. A function that carries `findByRouteKey` is a model binding whatever its declared type (`checkBinder` reads the static); a resolver must not carry it, and `Binder` refuses a callable with `findByRouteKey` and no string `primaryKey` at `r.bind()`, as the mount check does. A class without the statics is a compile error at `r.bind()`, and a runtime error at `Route.api` (a class without `findByRouteKey` would otherwise be called without `new`).
- **Bound value types.** A model class binds `InstanceType<C>`, not the return type of `findByRouteKey` (a subclass that inherits a base-typed lookup overrides it, [database.md › BindableModel](./database.md#bindablemodel)). A callable that carries the `BindableModel` statics but has no construct signature is a model at runtime (`isModelClass`), so it binds its lookup result. A resolver binds `NonNullable<Awaited<ReturnType<R>>>`, because a miss is a 404; a callable constructor such as `Date` is a resolver (it has no statics), whatever its `new` signature. An optional path param (`:post?`) binds `Model | undefined` when the request has none; a present one with no match is still a 404.
- **Optional layouts.** Hono expands a path that ends with `?` at registration: `checkOptionalParameter` registers every prefix ending at an optional segment and strips the `?` from all of them, so `/mixed/:first?/:post/:last?` is also served as `/mixed`, `/mixed/:first` and `/mixed/:first/:post`. A required binding the expansion leaves out would resolve `undefined` on a shorter registration, where the proof promises the model, so `Route.api` refuses it at mount. The check follows Hono's `RegExpRouter`, the stricter of Hono's routers (a `TrieRouter` fallback keeps the param, so the refusal can be conservative): it limits each registration to the first `paramCount - expansions + i + 1` params (`paramCount` counts the params of the full path), so a static segment after an optional param drops params the registration names: `/a/:post/:first?/fixed/:last?` also registers `/a/:post` (0 params: `/a/one` answers no `post`) and `/a/:post/:first` (1 param: `/a/one/two` answers no `first`). A binding, required or optional, on a param such a registration drops is therefore refused at mount when a static segment follows an optional param in its route path (Diagnostics). A path with no static segment after an optional param (`/a/:post/:first?`, `/a/:post/:opt?`) keeps binding, including a binding on the optional param: a present one runs its lookup and a miss is the 404, an absent one binds `undefined` (Bound value types).
- **Resolution.** A route gets its scopes' bindings (outer to inner), then its contract's, a later key winning, restricted to the path params of that route's full path: a contract may bind a key only some of its endpoints declare. Each bound model is resolved once per request, in map order, after the route middleware and before the planned policies (A3 [#121](https://github.com/Laratypes/Laratype/issues/121)) and the input validation: a 404 precedes a 422, while a 403 the route middleware answers precedes the 404, because middleware runs before the binding step (Binding is not authorization). A miss stops the lookups after it.
- **Miss.** `null` / `undefined` from `findByRouteKey` or a resolver is the 404 of the contract's derived path-param error: `{ code: "NOT_FOUND", message: "Not Found." }` ([Exceptions](#exceptions), [contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)). It is an expected answer, so it is not logged. An optional param the request does not carry binds `undefined` without a lookup. A route key the model cannot convert is its own miss: the router passes the raw string, so the model returns `null` / `undefined`. A throw from the lookup is not a miss but an answer from the exception filter (a `ContractError` such as `errors.validation({})` answers its own status, 422 included; a responsible `Exception` or a recognized HTTP error keeps its status; anything else is the generic 500) ([database.md › BindableModel](./database.md#bindablemodel)).
- **Binding is not authorization.** Binding checks no ownership: it loads the row for any request that reaches the binding step, so a 404 tells the caller that an id does not exist even when the request should have been denied. Authorization is route middleware that runs before the binding step, or a resolver that checks access. Router v2 `policy` options are recorded, not run, and an endpoint's `.authorize()` enforces nothing, until A3 [#121](https://github.com/Laratypes/Laratype/issues/121) lands. A non-enumerable route key (a UUID) only makes enumeration harder: a caller who knows the key still reaches the binding step and loads the row, so it is not an authorization option.
- **Context.** A binding contributes `{ params: { user: User } }` to the provided context (`Provided` / `Ctx`), merged over the raw path params. A typed middleware extension that also adds the key to `params` does not replace the bound model, at runtime or in the proof: the proof drops the bound keys from the extension's `params` before it merges (the binding wins, since the proof promises the bound type). The handler's second argument stays the raw path params object (strings). A binding key named after an `Object.prototype` member (`hasOwnProperty`, `toString`) shadows that member on `ctx.params`, so `ctx.params.hasOwnProperty(...)` throws: read keys with `Object.hasOwn(ctx.params, key)`, which never walks the prototype chain.
- **Scopes.** `r.bind({...}).scope('<folder>', { policy })` records the bindings on the mounted scope: at runtime every contract under that folder gets them. The type level is the builder, as for H6 scope middleware: `r.contract()` proves each handler when it runs, before the routes array exists, with the bindings of the builder that mounts the contract only. A scope binding on a param a contract under the folder declares must also be bound on that contract's own builder: it is refused otherwise, at `Route.api(...)` in the types and at mount at runtime: the route would pass a model where the handler's `params` type says string. Mount the scope and its contracts from the same bound builder. When both bind the same key, the contract's binder runs (a later key wins, Resolution), and the proof sees it, so the handler types match what runs.
- **No ORM dependency.** `@laratype/http` types the binder against its own structural shape and does not import `@laratype/database`. `@laratype/database` exports `BindableModel` type-only; any class with the three statics fits it without an `implements` clause.
- **0.5 routes unchanged.** `Route.model`, `Route.bind`, `explicitModelBinding` and `ModelBindingRegistry.paramModelMap` keep their 0.5 behavior; a `Route.api` route still takes no 0.5 model binding (`RouteParams.modelBinding: false`).
- **Runtime check.** `r.bind()` checks each value is a function; a value whose static `findByRouteKey` is a function is a model class and needs a string static `primaryKey` (the `Binder` type refuses a callable with `findByRouteKey` and no `primaryKey`, the same rule); a class (a `class` source) without `findByRouteKey` fails at mount; an arrow or plain function without it is a resolver. The map is copied with a spread, so it must be plain and enumerable: `Object.prototype` or `null` as its prototype, and its own string keys enumerable (a map made with `Object.create({ id: User })` or with `Object.defineProperty(map, 'id', { enumerable: false })` would bind nothing while the types say it binds; both are refused). `Route.api` runs the same check on the bindings of an item it did not build through `r.bind()` (a hand-built contract or scope item), reads that `bindings` once and stores the checked copy, so a map mutated in an `endpoints` callback, or a getter that answers another map on a later read, cannot install a binder the check never saw. A bad binder, or a `bindings` that is not an object, fails at mount instead of being skipped (a bad binder would otherwise answer 500 on every request). `__proto__` is not a binding key (Diagnostics): every object reads it as its prototype, so the binding would be dropped, and a map written as `{ __proto__: User }` sets the prototype of the map instead of binding a key, so it is refused too. `constructor` and `prototype` are ordinary keys, held as own properties of the ctx params.

### Diagnostics
Runtime `Error`s, prefixed `[@laratype/http] Route.api: `, and thrown by `Route.api` when the builder binds:
- `` r.bind(): `<key>` must be a model class (static primaryKey, optional routeKeyName, findByRouteKey(key)) or a (raw: string) => value resolver `` (a value that is not a function; also for an item built by hand, when `Route.api` checks its bindings)
- `` r.bind(): `__proto__` cannot be a binding key: every object reads it as its prototype, so the binding would be dropped. Fix: name the path param something else. `` (an own `__proto__` key, from `{ ["__proto__"]: User }` or a parsed object: Hono drops a `:__proto__` path param, so the handler would read `undefined`; refused at `r.bind()`, and at mount for a hand-built item)
- `` r.bind(): `{ __proto__: User }` sets the prototype of the bindings map instead of binding a key. Fix: name the path param something else. `` (that literal has no `__proto__` own key at all, so the key check never sees it; the map would bind nothing while the types say it binds `__proto__`)
- `` r.bind(): the bindings map must have Object.prototype or null as its prototype, not a class instance or an Object.create(base) object (got <prototype>) `` (an inherited entry is dropped by the copy, so the map would bind nothing while the types say it binds; `<prototype>` is `Foo.prototype` for a class instance, a `Map` or an array, or `an object that is not Object.prototype` for `Object.create({ id: User })`)
- `` r.bind(): the bindings must be an object, one value per path param (got <value>) `` (a hand-built item's `bindings` that is not an object, such as `42` or `null`: refused at mount; only an omitted `bindings` defaults to `{}`)
- `` r.bind(): `<key>` is a non-enumerable property of the bindings map: r.bind() copies enumerable own properties only, so the binding would be dropped. Fix: declare it as a plain property, { <key>: ... }. `` (an own key from `Object.defineProperty(map, '<key>', { value: User })`: the types say it binds, the spread drops it)
- `` r.bind(): `<key>` is a model class without a static primaryKey (the default route key of BindableModel) ``
- `` r.bind(): `<key>` is a model class without a static findByRouteKey (BindableModel: primaryKey, optional routeKeyName, findByRouteKey(key)) ``
- `` r.bind(): `<key>` is not a path param of any endpoint in <contract> `` (a key no endpoint of the contract declares would otherwise be dropped; typed callers get it at `r.contract()` already)
- `` r.bind(): `<key>` is not a path param of any endpoint under scope "<dir>" ``
- `` r.bind(): `<key>` binds `:<key>?` in <path>, where Hono registers it as `<key>?`: it expands only a path that ends with an optional param, so the binding would never run. Fix: make the optional param the last segment, or drop the `?`. `` (Hono's `checkOptionalParameter` expands a path ending in `?`, stripping the `?` from every optional segment; any other path is registered as written, so `param()` never answers `<key>` and the binding would read an absent optional param)
- `` r.bind(): `<key>` is a required param of <path> that Hono's optional-param expansion leaves out of a registration: Hono also registers `<expansion>`, where its router passes no `<key>` to the handler, so the binding would give `undefined` where the proof promises a model. Fix: move `<key>` before the optional params, or drop their `?`. `` (Hono expands `/mixed/:first?/:post/:last?` into `/mixed`, `/mixed/:first`, `/mixed/:first/:post` and the full path; a required binding is absent from a shorter registration, e.g. `post` from `/mixed`. A required key that every registration carries stays valid: Optional layouts)
- `` r.bind(): `<key>` is a param of <path> that Hono's RegExpRouter drops from a registration's handler map (a static segment follows an optional param): Hono also registers `<expansion>`, where the handler receives no `<key>` even when the request carries it, so the binding would give `undefined`. Fix: drop the `?` of the optional params, or move the static segment before them. `` (the router keeps the first `paramCount - expansions + i + 1` params of each registration; `/a/:post/:first?/fixed/:last?` registers `/a/:post` with no param and `/a/:post/:first` with only `post`, so `/a/one` has no `post` and `/a/one/two` has no `first`. A required or optional binding on `post` or `first` is refused; `/a/:post/:first?` and `/a/:post/:opt?` keep binding: Optional layouts)
- `` scope "<dir>" binds `<key>`, but contract "<name>" is mounted from a builder that does not bind it: mount the contract from a builder that binds `<key>` too (a handler's types see only its own builder's bindings) `` (the first such conflict in route order, before any request)
- The miss answers 404 with `{ code: "NOT_FOUND", message: "Not Found." }` (no log).

Type-level:
- `` .bind(): `<key>` is not a path param of any endpoint in <contract> `` at `r.contract()` ([Route proof](#route-proof-at-rcontract) › Diagnostics).
- `` Route.api: scope "<dir>" binds `<key>`, but contract "<name>" is mounted from a builder that does not bind it: mount the contract from a builder that binds `<key>` too (a handler's types see only its own builder's bindings) `` at the `Route.api(...)` call (the scope-binding rule above).
- A class that does not satisfy the static side, at `r.bind()`: `Type 'typeof Plain' is not assignable to type 'Binder'.` with `Type 'typeof Plain' is missing the following properties from type 'BindableModelClass<object>': primaryKey, findByRouteKey` (an object argument reports it at the value's key).
- A callable that carries `findByRouteKey` but no string `primaryKey`, at `r.bind()`: it is not assignable to `Binder` (it is neither `ModelFunction`, which needs `primaryKey`, nor `Resolver`, which must not carry `findByRouteKey`), as the mount check refuses it. A callable with `primaryKey` and no lookup is a resolver, as at runtime.
- A handler that requires a model the route does not bind keeps the proof's diagnosis: `` <c>.<e>: `params.user` provided by the route does not match the handler (missing .bind()?) ``.

### Example
Compiled (proposed API): [`docs/v1/examples/http/proposed/modelBinding.ts`](./examples/http/proposed/modelBinding.ts).
```ts
// app/api/users/[user]/posts.ts: `user` is a folder param, `post` an endpoint param
const posts = defineContract()({
  show: endpoint.get('/:post').response(PostDto),
  latest: endpoint.get('/latest/:post?').response(PostDto),
})

class PostController extends Controller {
  show(ctx: Ctx<typeof posts.show, { params: { user: User; post: Post } }>) { return { id: ctx.params.user.id, slug: ctx.params.post.slug } }
  latest(ctx: Ctx<typeof posts.latest, { params: { user: User; post: Post | undefined } }>) {
    return { id: ctx.params.user.id, slug: ctx.params.post?.slug ?? '' }
  }
}

Route.api(appApi, (r) => [r.bind({ user: User, post: Post }).contract(posts, PostController)])
```

Or, with a resolver for `user` (an alternative mount of the same contract, not a second route):

```ts
Route.api(appApi, (r) => [
  // a resolver gets the raw string; null / undefined is a 404
  r.bind({ user: (raw: string) => User.findByRouteKey(raw), post: Post }).contract(posts, PostController),
])
```
Tests: [`packages/http/__tests__/routing/modelBinding.test.ts`](../../packages/http/__tests__/routing/modelBinding.test.ts) (requests through `app.request()`: folder and endpoint params, a regex param pattern, a pattern with a brace in a class or a nested quantifier, the raw second argument, a class miss and a resolver miss as 404, the optional param (a name that is an `Object.prototype` member included), one lookup per request, the frozen copy, a binding over a middleware `params` extension, 404 before 422, `Date` and a callable model class, the scope builder (same builder passing, a scope-only key refused at mount, a contract binder winning), a binding key no endpoint declares, a `__proto__` key refused, an `Object.create({ id: User })` map, a class-instance map and a non-enumerable key refused, a null-prototype map binding, a wrong-type map (a number, `null`, `undefined`, a string) and `NaN` / `Infinity` binders refused, a `{ length: 1e9 }` map checked as one key named `length`, a 10k unicode key checked as an ordinary key, a hand-built contract and scope item with a non-binder value or a non-object `bindings` refused at mount, a hand-built item's map mutated from an `endpoints` callback, its `bindings` getter read once (scope and contract), a Proxy key with no descriptor, a mid-path optional param Hono registers as `:key?` refused while the paths it expands still bind (two optionals included), a required binding after an optional param refused (the `/mixed/:first?/:post/:last?` path, `/mixed` named as the missing expansion), a required or optional binding a static segment after an optional one drops from Hono's handler map refused (the `/a/:post/:first?/fixed/:last?` path, `/a/:post` for `post` and `/a/:post/:first` for `first`, with the static-segment fix), an optional binding on that layout refused while `/a/:post/:first?` mounts and a present-but-unknown `first` is a 404, and the optional bindings of `/mixed/...` and `/a/:post/:opt?` still bind, ad-hoc routes) and [`modelBinding.test-d.ts`](../../packages/http/__tests__/routing/modelBinding.test-d.ts) (the binder types, a later bind winning, a binding over a middleware `params` key, a wrong key, a class outside `BindableModel`, a callable with `findByRouteKey` and no `primaryKey` refused as at mount, the optional param, the scope builder, the refused scope-only key with its exact `Route.api` diagnosis).

### Non-goals
- **No implicit binding:** H14 [#163](https://github.com/Laratypes/Laratype/issues/163) is planned.
- No per-endpoint binding in the `endpoints` callbacks of `r.contract()`: the callbacks are checked before the options argument, so their bindings cannot join the proof (the same limitation as typed middleware there).
- No binding for ad-hoc routes: `r.get()`, `r.post()` and the others have no contract and no typed params, so a bound builder's bindings are ignored and the handler gets the raw params.
- No binding of query or body values, and no custom miss behavior: a miss is always the 404.
- No whole-tuple proof: the handler proof runs per `r.contract()` call, before the routes array exists, so a scope binding is refused unless the contract's own builder binds the same key (Scopes). A later proof of the returned array would let the proof see a sibling scope's bindings.
- No removal of the 0.5 `Route.model` / `Route.bind` paths in this task.

### Open questions
- Resolved: an optional path param with `.bind()` is `Model | undefined` when absent; a present one with no match is a 404 ([#118](https://github.com/Laratypes/Laratype/issues/118)).
- Resolved: a route key the model cannot convert is its own miss, and a thrown lookup goes through the exception filter (Invariants › Miss) ([#118](https://github.com/Laratypes/Laratype/issues/118), [database.md › BindableModel](./database.md#bindablemodel)).
- Deferred: an explicit binding kind ([#163](https://github.com/Laratypes/Laratype/issues/163)): a callable whose declared type is a resolver but whose runtime value carries the model statics is dispatched as a model (`isModelClass`). A function with `findByRouteKey` is always a model binding, and a resolver must not carry it (Invariants › Values); a `{ model: ... }` wrapper that makes the kind explicit is an API change for H14.

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
`r.scope()` is merged ([#104](https://github.com/Laratypes/Laratype/issues/104), H1): it mounts a scope policy, records it on the routes under the folder and checks that every scope with `authorize` has one ([Router v2](#router-v2)). `r.contract(c, Ctrl, { policy })` is merged and recorded on the routes (H2a [#105](https://github.com/Laratypes/Laratype/issues/105)). The compile check is planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2b); running policies, in the order below, is planned → [#105](https://github.com/Laratypes/Laratype/issues/105) ([auth.md › Policies and gates](./auth.md#policies-and-gates) leaves the call there too). Until then `authorize` is not enforced.

### Design (non-binding)
- **Declared in the contract:** `authorize: true` on a [folder scope](./contract.md#folder-scopes) or `.authorize()` on an endpoint adds a 403 ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)).
- **Mounted on the server:** `r.scope('<folder>', { policy })` for a scope, and `r.contract(c, Ctrl, { policy })` for endpoints.
- **Compile check:**
  - every endpoint with `.authorize()` needs a policy that has a method for that endpoint (named after the endpoint key), or a `before` hook;
  - a scope with `authorize` and no mounted policy is a compile error in `Route.api`, with a runtime check too;
  - `authorize` without `auth` at the same or an outer level, including `.public()` under a scope with `authorize`, is a compile error ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)).
- **Order:** scope policies run once per request, outer to inner, then the endpoint's policy. Bound models are resolved once and reused.
- **Scope hook:** a scope policy's `before(user, ability, params)` receives the signed-in user, the endpoint's key as the ability and the scope's bound params (the resolved models).
- **`Gate.policy`:** `Gate.policy(Model, Policy)` stays for imperative checks such as `user.can('update', post)` in services ([auth.md › Policies and gates](./auth.md#policies-and-gates)).
- **Replaces:** the route-level `.can()` ([Policies on routes](#policies-on-routes-can)) and `FormRequest.authorize()` ([validation.md › FormRequest v2](./validation.md#formrequest-v2)).

### Open questions
- The arguments of an endpoint's policy method → [#105](https://github.com/Laratypes/Laratype/issues/105)

### Acceptance
[#105 Done when](https://github.com/Laratypes/Laratype/issues/105) · [#121 Done when](https://github.com/Laratypes/Laratype/issues/121)

---

## Request.ip()

### Status
proposed: PR [#400](https://github.com/Laratypes/Laratype/pull/400) @ 5fba1d5d (H30 [#299](https://github.com/Laratypes/Laratype/issues/299), M2). A5 [#288](https://github.com/Laratypes/Laratype/issues/288) added `ip()` on the Node and Bun adapters; this round registers the adapter's `getConnInfo`, drops `@hono/node-server` from `@laratype/http` and normalizes the address. Round 2 warns once when a rate-limited route runs with no address source registered; round 3 adds the second warning for a registered getter that finds no address. Round 4 reads the address once, when the `mountConnInfo` middleware runs (a reset connection loses it after an `await`), refuses a mount after a route or middleware, and never runs a throttled handler for a request whose connection closed before its address was read. Trusted proxy headers are H35 [#320](https://github.com/Laratypes/Laratype/issues/320), a later round. Leader fixup round 3: a copy that loads without `mountConnInfo` (an import failure the loader logged, or an older copy) gets a second one-per-process warning, and the missing-package warning names `process.cwd()` and offers adding `@laratype/http` as a direct dependency of the app for an unhoisted optional peer.

### Public API
`request.ip(): string | undefined`, a method of the 0.5 `Request` (`RequestInterface`) and every request class that extends it. Code: [`supports/Request.ts`](https://github.com/Laratypes/Laratype/blob/5fba1d5dbca18d583dafe05382dbeb45b6c07a1c/packages/http/src/supports/Request.ts), [`supports/ip.ts`](https://github.com/Laratypes/Laratype/blob/5fba1d5dbca18d583dafe05382dbeb45b6c07a1c/packages/http/src/supports/ip.ts).

The serving adapter registers its runtime's Hono `getConnInfo` with `mountConnInfo()`, which mounts one middleware on the Hono app:

```ts
// @laratype/http
export function mountConnInfo<E extends Env, S extends Schema, BasePath extends string>(
  app: Hono<E, S, BasePath>,
  getConnInfo: GetConnInfo,
): void
```

`GetConnInfo` is Hono's `(c: Context) => ConnInfo` from `hono/conninfo`.

`mountConnInfo()` mounts one middleware that calls the getter **once, synchronously, when it runs** and stores the address it answered on the request's context; `ip()` and the rate limit read that capture, never a later call. Mount it before any middleware that can await (a session load, an auth load, a request log): a client that resets its connection during that await has no socket address left to read, and a late mount is refused at boot ([Diagnostics](#diagnostics-10)). The examples below show it mounted first, on a fresh app.

```ts
// A node entry, before the routes are mounted
import { mountConnInfo } from "@laratype/http"
import { getConnInfo } from "@hono/node-server/conninfo"

mountConnInfo(app, getConnInfo)
```

```ts
// A Bun entry
import { getConnInfo } from "hono/bun"

mountConnInfo(app, getConnInfo)
```

`sauf`'s node adapter (`sauf build`'s node entry) and `sauf dev` mount the node one themselves, before the app's providers boot. An adapter that mounts none leaves `ip()` `undefined`. An app where `@laratype/http` does not resolve (not installed where the app runs, or left unhoisted, as pnpm can) registers no `getConnInfo` and gets one warning per process that `request.ip()` stays `undefined` (so `.throttle()` routes keyed by IP have no address); a copy that resolves but fails to import is logged by the loader, and the mount then warns once that `@laratype/http` loaded without `mountConnInfo` (the failed import or an older copy); any other rejection of the loader is thrown. `sauf` resolves the package from `process.cwd()`.

A Bun or custom entry must call it: before H30 the Bun runtime was detected automatically, now an entry that mounts nothing gets `ip() === undefined` and every `.throttle()` route serves without a limit, with one warning per process ([Rate limiting](#rate-limiting) › Diagnostics).

### Invariants
- **Source: the registered getter, nothing else.** `ip()` answers the `remote.address` the adapter's `getConnInfo` found with the request's Hono context when `mountConnInfo`'s middleware ran. `@laratype/http` has no per-runtime branch and never reads the shape of `ctx.env` (`incoming`, `requestIP`, `server`): an adapter registers what its runtime offers, and `sauf`'s node entry is the only place that knows about the node server.
- **Captured once, when the middleware runs.** The getter is called once per request, synchronously, before the middleware's `next()`: the normalized address is stored on the context and every later `ip()` (and the rate limit) reads that value. It is never called again after an `await`, where a connection the client reset has no address left (Node caches `socket.remoteAddress` only once it has been read). A getter from another copy of the package that stored itself on the context is the one lazy path left; no app booted with this copy's `mountConnInfo` has it.
- **No adapter, no address.** With no `mountConnInfo()` (an in-process `app.request()` in a test, a Hono app a bare kernel served, another runtime) `ip()` answers `undefined`. It also answers `undefined` when the getter throws (a Bun `requestIP()` returning null for a unix socket, a socket gone) or answers no `remote.address`: it never throws, so a route that reads it cannot turn a missing socket into a 500.
- **No source, one warning; no address, another.** The first `.throttle()` route that runs with no getter registered logs one warning per process, in every mode, naming the fix ([Rate limiting](#rate-limiting) › Diagnostics). A registered getter that finds no address (a unix socket or named pipe, a socket gone, a getter for another runtime) is a second cause the rate limit warns about once per process: those requests are unthrottled too, and a unix-socket or proxy deployment needs H35 [#320](https://github.com/Laratypes/Laratype/issues/320)'s trusted-proxy setting for a limit. `ip()` itself logs nothing.
- **A gone connection never runs a throttled handler.** If the registered getter captured no address **and** the connection is already closed (`c.req.raw.signal.aborted`, or the node adapter's `c.env.incoming.socket.destroyed`), a `.throttle()` route answers `204` with no body without running the handler: the client cannot receive an answer, and a side-effecting handler (an OTP, an SMS, a signup) must not run with no limit. A live request with no address (a unix socket) keeps the warning and runs the handler, unthrottled, as round 3 left it.
- **Normalized.** An IPv4-mapped IPv6 address (`::ffff:203.0.113.7`, any case, and the expanded `0:0:0:0:0:ffff:203.0.113.7`) is the IPv4 address it carries: a dual-stack listener reports an IPv4 client as `::ffff:<v4>` with family `IPv6` (checked with a `net` server on `::`: Node reported `::ffff:127.0.0.1`; the `::ffff:0:` IPv4-translated form is a different range and stays IPv6). An IPv6 zone id (`fe80::1%eth0`, `fe80::1%3`) is stripped. A plain IPv4 or IPv6 address is returned as the runtime wrote it.
- **Anything else is no address.** An empty string, `null`, `undefined`, a non-string (an object, a number, `NaN`, an array), a string that is not an IPv4/IPv6 address (a blank one, a very long one, one with control characters, a header value) all answer `undefined`. `ip()` never turns text no socket produced into a client address.
- **Never a proxy header.** `X-Forwarded-For` and `X-Real-IP` are never read: behind a proxy `ip()` is the proxy's address until the trusted-proxy setting (H35 [#320](https://github.com/Laratypes/Laratype/issues/320)) names the proxies it may skip. Spoofing either header changes nothing.
- **Mounted first, or the boot fails.** Hono runs a middleware registered after a route only after that route, and after an earlier middleware, so `mountConnInfo()` must run on the fresh app before anything that can await. A mount when `app.routes` already has a route or middleware (other than this function's own earlier mounts) throws ([Diagnostics](#diagnostics-10)). `sauf`'s node entry and `sauf dev` mount it before `Serve.bootProvider()` boots the app's providers. Mounting it twice in a row is still harmless: each middleware captures the address and the last one to run wins. The check sees only the app it is given: call `mountConnInfo` on the outermost app that serves requests, because a sub-app mounted behind an async middleware of its parent (`parent.route("/", app)`) captures after that await.
- **The rate limit reads it.** `Route.api`'s contract throttle keys its window on `request.ip()` (A5 [#288](https://github.com/Laratypes/Laratype/issues/288)): `undefined` is an unthrottled request, never a shared bucket, and one with no source registered warns once ([Rate limiting](#rate-limiting)). A request whose connection closed before the capture never reaches the handler ([Rate limiting](#rate-limiting) › Invariants).

### Diagnostics
`mountConnInfo()` fails the boot with a `TypeError` on a wrong argument, and refuses a late mount with an `Error`:

- `[@laratype/http] mountConnInfo(): expected the runtime's getConnInfo(context) function, got <typeof>` (a missing or non-function `getConnInfo`)
- `[@laratype/http] mountConnInfo(): expected a Hono app, got <null|typeof>` (an `app` with no `use()`)
- `[@laratype/http] mountConnInfo(): call it before any route or middleware, so the address is captured before one can await; the app already has <n> route(s) or middleware` (a mount after `app.routes` already has anything that is not this function's own earlier mount; the count is what was already there)

The node mount warns once per process, and skips the mount, when it has no `mountConnInfo` to call:

- `[sauf] If this app serves routes with @laratype/http, request.ip() stays undefined and .throttle() routes keyed by IP have no address: @laratype/http does not resolve from the working directory <process.cwd()> (it is an optional peer of laratype). Install @laratype/http where the app runs and start the app from the project root, or add @laratype/http as a direct dependency of the app.` (a resolution failure of the package itself; any other rejection of the loader is thrown)
- `[sauf] If this app serves routes with @laratype/http, request.ip() stays undefined and .throttle() routes keyed by IP have no address: @laratype/http loaded without mountConnInfo (its import failed and the loader logged that above, or the app has an older copy of the package).` (support's `importModule` logs a failed import of a resolvable module and returns `undefined`, so that failure is not thrown)

A getConnInfo that throws at capture time makes `ip()` answer `undefined`; the rate limit logs one warning per process the first time a throttled route sees it ([Rate limiting](#rate-limiting) › Diagnostics).

The first rate-limited route that runs with no getConnInfo registered warns once per process, in every mode, and so does one whose registered getter finds no address: [Rate limiting](#rate-limiting) › Diagnostics has both texts.

### Example
```ts
// app/http/controllers/WhoAmIController.ts
import { Controller } from "@laratype/http"
import type { Request } from "@laratype/http"

class WhoAmIController extends Controller {
  index(request: Request) {
    return { ip: request.ip() ?? null }
  }
}
```

A node entry mounts the getter before the routes (what `sauf`'s node entry does):

```ts
import { Hono } from "hono"
import { mountConnInfo } from "@laratype/http"
import { getConnInfo } from "@hono/node-server/conninfo"

const app = new Hono()
mountConnInfo(app, getConnInfo)
```

Tests: [`packages/http/__tests__/support/bearerTokenAndIp.test.ts`](../../packages/http/__tests__/support/bearerTokenAndIp.test.ts) (a node-shaped and a Bun-shaped getter, no registration, a throwing getter, non-string and invalid addresses, mapped upper/lower/expanded, a zone id, a plain IPv6, a very long string, control characters, spoofed proxy headers, the two `mountConnInfo` `TypeError`s, the late-mount `Error`, the getter read once before an awaiting middleware, the older-copy getter fallback), [`packages/http/__tests__/support/requestIp.test-d.ts`](../../packages/http/__tests__/support/requestIp.test-d.ts) (the `ip()` return type and `mountConnInfo`'s generic app parameter, including an app with typed bindings), [`packages/http/__tests__/routing/throttle.test.ts`](../../packages/http/__tests__/routing/throttle.test.ts) (the no-source warning once per process across routes and in production, the no-address warning once across routes for an addressless or throwing getter, none for a working getter, the two flags independent, the IPv4-carrying IPv6 forms, the `204` for a closed connection with no address and the handler left alone, the live unreadable connection that still runs it) and [`packages/sauf/__tests__/throttleReset.test.ts`](../../packages/sauf/__tests__/throttleReset.test.ts) (a real `@hono/node-server`, a 100 ms global middleware and a client that resets after the write: the captured `127.0.0.1` is counted, the side-effect counter stops at the limit and a live request gets 429) and [`packages/sauf/__tests__/requestIp.test.ts`](../../packages/sauf/__tests__/requestIp.test.ts) (a real node server, a dual-stack listener's IPv4-mapped address, and the on-demand load: a package that does not resolve warns once, a loaded copy without `mountConnInfo` warns once too, a copy that throws at import is logged by the loader and then warns the same way, and the rethrow cases (an inner dependency, a look-alike package, another module) are guards tested with a stub loader that rejects).

### Non-goals
- No trusted-proxy setting and no `X-Forwarded-For` / `X-Real-IP` fallback: H35 [#320](https://github.com/Laratypes/Laratype/issues/320).
- No runtime detection inside `@laratype/http`: the adapter registers its getter.
- No asynchronous `getConnInfo`: Hono's is sync, and an async one answers a `Promise`, which is no address.
- No port, family, hostname or DNS lookup: the address only.

### Open questions
- None recorded.

### Acceptance
[#299 Done when](https://github.com/Laratypes/Laratype/issues/299)

---

## Rate limiting

### Status
merged: PR [#305](https://github.com/Laratypes/Laratype/pull/305) @ 9934cf2d (H17 [#229](https://github.com/Laratypes/Laratype/issues/229), M2); H30 text: PR [#400](https://github.com/Laratypes/Laratype/pull/400) @ 5fba1d5d. H30 [#299](https://github.com/Laratypes/Laratype/issues/299) round 2: one warning when no address source is registered, and the IPv4 address a SIIT or IPv4-compatible form carries is the bucket; round 3: a registered getter that finds no address warns once per process too, and a unix-socket or proxy deployment needs H35 [#320](https://github.com/Laratypes/Laratype/issues/320) for a limit; round 4: the address is read once before any `await`, and a request whose connection closed before it was read answers `204` without running the handler. H34 [#319](https://github.com/Laratypes/Laratype/issues/319) follow-ups, proposed: PR #PRNUM @ 7071858f — the store caps windows per client prefix and `mount()` gives each mount its own store (items 1 and 3); the limit stays at `mount()`, before the contract auth guard and the body read, keyed by the client address, with no user-id window (item 2); the 429 keeps the app-wide CORS headers, and `Retry-After` needs `cors.exposeHeaders` (item 4). Counters through the cache: planned → [#166](https://github.com/Laratypes/Laratype/issues/166).

### Public API
None: `ApiRoutes.mount()` applies the rate limit of each route whose resolved `throttle` is set ([`throttle.ts` @ 7071858f](https://github.com/Laratypes/Laratype/blob/7071858f/packages/http/src/routing/api/throttle.ts)). The `ThrottleStore` interface is internal, and each `mount()` creates one `MemoryThrottleStore`: injecting a store (the cache's, or a test's) is deferred to CA1 [#166](https://github.com/Laratypes/Laratype/issues/166).

### Invariants
- **Declared in the contract:** `.throttle({ limit, per })` on a scope, a contract or an endpoint. The nearest level wins, and `.throttle(false)` opts out ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)). A route whose resolved `throttle` is unset is never limited and never counted.
- **Applied when routes are registered,** with no route middleware: `mount()` wraps the route's handler, so the limit runs before the route middleware, before the request parsing and before the kernel's body read. On a `.domain()` route, only requests for that host are counted.
- **Fixed window per route and client.** Each route (its method, `.domain()` host and path, so same-named routes of two groups or domains never share a counter) counts its own hits per client in windows of `per` (seconds, or `"<n>s|m|h|d"`; from 1 second to `Number.MAX_SAFE_INTEGER` ms, as the contract checks). The window starts at the client's first hit; the hit past `limit` in a window, and every hit after it in that window, answers 429.
- **Key:** the IP is `request.ip()` (A5 [#288](https://github.com/Laratypes/Laratype/issues/288), H30 [#299](https://github.com/Laratypes/Laratype/issues/299)): the socket address the serving adapter registers through `getConnInfo` ([Request.ip()](#requestip)), read once when `mountConnInfo`'s middleware ran, never `X-Forwarded-For`, so behind a proxy it is the proxy's address until a trusted-proxy setting exists. `request.ip()` has already normalized an IPv4-mapped IPv6 address (`::ffff:203.0.113.5` from a dual-stack listener) to its IPv4 address, and this bucket maps the IPv4 address carried in `64:ff9b::203.0.113.5` (NAT64), `::ffff:0:203.0.113.5` (SIIT) and `::203.0.113.5` (IPv4-compatible, except `::` and `::1`) too; any other IPv6 client is counted by its /64, the block one client can rotate addresses in. **Keying by the user id is decided against ([#319](https://github.com/Laratypes/Laratype/issues/319)):** the contract auth guard runs inside the kernel, after this mount-level limit and after the body read, so a user-keyed window would be a second limit with its own budget; it could not replace this one, because an unauthenticated flood has no user to key on. Users behind one address (a proxy or a NAT) share one budget until H35 [#320](https://github.com/Laratypes/Laratype/issues/320)'s trusted-proxy setting.
- **A source is required, or the limit is off.** A Bun or custom entry must call `mountConnInfo(app, getConnInfo from hono/bun or @hono/node-server/conninfo)` before the routes are mounted. Before H30 a Bun entry was detected automatically; now an entry that mounts none registers no getter, so `request.ip()` is `undefined` and every `.throttle()` route serves without a limit. The first such request logs one warning per process, in every mode including production ([Diagnostics](#diagnostics-11)).
- **No address, no limit; a gone connection, no handler.** A request whose *registered* getter finds no address (`request.ip()` is `undefined`: a unix socket or named pipe, a socket gone, an empty `remote.address`, a getter for another runtime) is served unthrottled, so clients without an address never share one bucket. The first such request logs one warning per process, in every mode, naming the first route ([Diagnostics](#diagnostics-11)): it disables every `.throttle()` route, and a unix-socket or proxy deployment needs the trusted-proxy setting (H35 [#320](https://github.com/Laratypes/Laratype/issues/320)) for a limit. If the connection is already closed when the limit runs (`c.req.raw.signal.aborted`, or the node socket `destroyed`), there is no one to serve and no bucket to count: the request answers `204` with no body and the handler never runs, so a side-effecting route cannot be called without a limit by a client that resets after the write. A live request with no address keeps the warning and the unthrottled handler.
- **Response:** 429 with the catalog error body `{ code: "TOO_MANY_REQUESTS", message: "Too Many Requests." }` ([Exceptions](#exceptions)) and `Retry-After`, the whole seconds until the window ends (at least 1). It is thrown as a Hono `HTTPException`, so the exception path of `ResponseKernel` answers it; Hono's own error handler answers it too on a bare Hono app, where a thrown `ContractError` would be a generic 500. The 429 keeps the headers the app-wide CORS middleware set (`app/config/cors.ts`: `Access-Control-Allow-Origin`, `Vary: Origin`) and `Cache-Control: no-store`. `Retry-After` is not CORS-safelisted: a cross-origin frontend reads it only when the app lists it in `cors.exposeHeaders` ([CORS](#cors) › Exposed headers, #319). The limit runs at `mount()`, before any route middleware, so a route-level CORS middleware never runs on a 429 and cannot decorate it; a Hono `cors()` is not a `MiddlewareItem` (it fails `Route.api` as "not middleware"), so the app-wide config, or a path-scoped `cors()` mounted on the app before the routes, is the supported path.
- **Store:** one `MemoryThrottleStore` per `ApiRoutes.mount()` call, so two apps (or two test mounts) never share counters, and counters are not shared between processes; injecting a store is deferred to CA1 [#166](https://github.com/Laratypes/Laratype/issues/166). Ended windows are dropped at most once a minute. A client prefix — the IPv4 address, or the IPv6 /48 of a /64 bucket, the 65,536 /64s one client can rotate inside — keeps at most 1,024 windows (about 0.5 MiB): past it the prefix drops its own window that ends first, so one client's volume cannot evict another client's window. Past 100,000 windows (about 45 MiB) the store drops the window that ends first: an ended one if there is one, else the live one nearest its end (its client starts a new window early), whichever prefix it belongs to. It finds the global one among the oldest window of each window length, with no scan of the store. `mount()` checks the window again before it registers any route.

### Diagnostics
- `[@laratype/http] Route.api: <route name>: throttle per must be from 1 second to 9007199254740991 ms, got <per>` (at `mount()`; the contract already rejects such a `per`)

Warning, logged once per process, in every mode, when a throttled route runs with no getConnInfo registered: `[@laratype/http] Route.api: no getConnInfo is registered, so .throttle() routes serve requests without a limit: a Bun or custom entry must call mountConnInfo(app, getConnInfo from hono/bun or @hono/node-server/conninfo) before the routes are mounted (first: <route name>)`

Warning, logged once per process, in every mode, when the registered getConnInfo finds no client address or throws (a unix socket or named pipe, a getter for another runtime): `[@laratype/http] Route.api: the registered getConnInfo found no client address (a unix socket or named pipe, or a getter for another runtime), so .throttle() routes serve such requests without a limit; behind a proxy or a unix socket the limit needs the trusted-proxy setting (#320) (first: <route name>)`

Neither warning includes request data: each names the first throttled route only. A request answered `204` because its connection closed before its address was captured logs neither warning: the warning describes a live request whose rate limit is off.

### Example
```ts
// app/api/_scope.ts
export default defineScope<ScopePrefix>()({ throttle: { limit: 100, per: '1m' } })
// app/api/posts.ts
export default defineContract<Prefix>()({
  index: endpoint.get('/').response(PostList),                                // 100 per minute, from the scope
  store: endpoint.post('/').body(NewPost).throttle({ limit: 5, per: '1m' }), // 5 per minute
  health: endpoint.get('/health').throttle(false),                            // never limited
})
```

Tests: [`packages/http/__tests__/routing/throttle.test.ts`](../../packages/http/__tests__/routing/throttle.test.ts) (requests through `app.request()`, with a mounted getter that reads the client address from the request's env; a second app without the seam warns once for several routes and requests, in production too, and a registered getter that throws or finds no address warns once on the first throttled route, while a working getter does not warn and the two flags are independent; an aborted signal or a destroyed socket with no address answers `204` without the handler and without a warning, an unreadable `c.env` is live, and a captured address still counts with the socket gone; `ipBucket` keys the SIIT, IPv4-compatible and mapped forms by the IPv4 address they carry; the store's per-client-prefix cap (its own windows are evicted, another prefix's window keeps counting, the global cap still bounds many prefixes), `clientPrefix`, one store per mount (two apps do not share a window), the 429 before the contract auth guard (the guard is not called on the flood and a 429 answers instead of a 401) and two users on one address sharing one budget; and a bare Hono app with Hono's own `cors()` answering the 429 with `Access-Control-Allow-Origin` and `Retry-After`) and [`packages/http/__tests__/middleware/cors.test.ts`](../../packages/http/__tests__/middleware/cors.test.ts) (the 429 keeps `Vary: Origin`, `Cache-Control: no-store` and the exposed `Retry-After`) and [`packages/sauf/__tests__/throttleReset.test.ts`](../../packages/sauf/__tests__/throttleReset.test.ts) (a real node server, a 100 ms global middleware and five clients that reset after the write: the side-effect counter stops at the limit and the captured `127.0.0.1` bucket answers a later live request with 429).

### Non-goals
- No stacked limits on one endpoint (named limiters, later).
- No `X-RateLimit-*` headers.
- No trusted-proxy setting: it must be an explicit opt-in that names the proxies.

### Open questions
- None recorded.

### Acceptance
[#229 Done when](https://github.com/Laratypes/Laratype/issues/229)

---

## Resources

### Status
merged @ 0334308 (PR [#309](https://github.com/Laratypes/Laratype/pull/309), H9 [#123](https://github.com/Laratypes/Laratype/issues/123)). The refused `toJSON` and `constructor` keys and the `V extends ConcreteValue` constraint of `when()`: proposed: PR [#334](https://github.com/Laratypes/Laratype/pull/334) @ c93aebf (H38 [#323](https://github.com/Laratypes/Laratype/issues/323)). The 0.5 `JsonResource` and `ResourceCollection` stay as they are, and unchecked (`ResponseEscape`).

### Public API
[`packages/http/src/resource/defineResource.ts`](https://github.com/Laratypes/Laratype/blob/c93aebf/packages/http/src/resource/defineResource.ts):

```ts
function defineResource<M extends abstract new (...args: any) => any, R extends ResourceData>(   // an object, not an array or a promise
  model: M, fn: (model: InstanceType<M>) => R): Resource<M, ResourceOutput<R>>;

interface Resource<M, Out> {
  make(model: InstanceType<M>): Out;
  collection(models: Iterable<InstanceType<M>>): Out[];
  paginate<P extends { readonly data: Iterable<InstanceType<M>> }>(page: P): ResourcePage<P, Out>;   // { ...P without data, data: Out[] }
}

function when<V extends ConcreteValue>(condition: boolean, value: V): V | MissingValue;   // the value as it is (a function too)
type ConcreteValue;   // object | string | number | boolean | bigint | symbol | void | null | undefined: not exported, it refuses unknown and lets any through
type ResourceOutput<R>;   // R with each key that may be MissingValue optional, without MissingValue; one object per member of a union
interface MissingValue;   // branded: what when() gives for a false condition
```

### Invariants
- **Plain data:** `.make`, `.collection` and `.paginate` return the mapped data itself, not a wrapper, so the response path serializes it as any object or array (no change to the response path, H4 [#107](https://github.com/Laratypes/Laratype/issues/107)).
- **Contract check:** a handler that returns a resource's data goes through the return check of [Route proof at r.contract()](#route-proof-at-rcontract): `[Out] extends [Result<E>]`, the response schema **input**. A mismatch is `<c>.<e>: return type does not match the response schema`. The contract is the source of truth: a resource must satisfy it, and the schema is never derived from the resource.
- **Inferred output:** the output type is what `fn` returns. A key whose value may be `MissingValue` (a `when()`) is optional; a key typed `any`, `unknown` or `object` stays required. A union return gives one output object per member; a discriminated union's output narrows per member.
- **when():** a false condition drops the key from `make`'s result; a true one keeps the value as it is. A function value is kept, never called (a conditional expression computes a value only when needed). `when()` accepts a generic value: the value needs a concrete type (the `V extends ConcreteValue` constraint), so `unknown` does not compile, while `any` is not refused, as everywhere else in the route checks (and then the key stays required, like any other `any` key). The check is a constraint, not a conditional, since a conditional is deferred for a generic `V` and would reject it. Only the top-level keys of `fn`'s result are dropped: a nested `when()` keeps `MissingValue` in the type, so the contract check rejects it; at runtime its `toJSON` leaves it out of a nested object and gives `null` in an array. The missing value is branded with `Symbol.for("laratype.resource.missing")`, so two copies of the module agree on it at runtime.
- **The model class** types `fn`'s argument and is not checked at runtime. `fn` is synchronous and returns a plain object: an array, a promise or an object with a `then` key (a thenable) does not compile, and a class instance or `null` throws at `make` (a copy would lose its getters).
- **paginate** takes a plain page object with `data`, maps `data` and copies the page's other own fields as they are (per member of a union page type). The plain `Page` of [database.md › Model](./database.md#model) (`{ data, total, perPage, currentPage, lastPage }`, all plain own fields) is accepted directly; a paginator class instance throws (DB1 [#145](https://github.com/Laratypes/Laratype/issues/145) decided the paginator is that plain `Page`).
- `make` copies the result's own enumerable keys into a new object, symbol keys included, and a `__proto__` key stays an own key. The resource object is frozen.
- **Refused keys:** `make` throws on a top-level `toJSON` or `constructor` key of the data `fn` returns, instead of copying it — a key that a `when()` would drop throws too, so the failure does not depend on data. A `toJSON` key makes JSON.stringify send what it returns instead of the `Out` the contract checked, and a `constructor` key makes the 0.5 `ResponseSupport.shouldBeJson()` (`content.constructor === Object`) send the body as text/html. Only the data's own enumerable top-level keys are inspected: a nested `toJSON` stays the nested object's business, and `paginate` copies the page's other fields as they are.

### Diagnostics
- `[@laratype/http] <Model>: the resource function must return a plain object, got an instance of <Class>` (or `got null`, `got undefined`, ...)
- `[@laratype/http] <Model>: the resource function must not return a toJSON key: JSON.stringify would send its result instead of the resource data`
- `[@laratype/http] <Model>: the resource function must not return a constructor key: the body would be sent as text/html instead of JSON`
- `[@laratype/http] <Model>: paginate() takes a plain page object ({ data, ...meta }), got an instance of <Class>` (or `got null`, ...)
- `[@laratype/http] <Model>: paginate() takes a page whose data holds the models, got data <value>` (or `got data undefined`, ...)
- A value typed `unknown`: `Argument of type 'unknown' is not assignable to parameter of type 'ConcreteValue'` (`when()`). A value of an unconstrained generic type `T` gives the same error naming `T`; constrain `T` to a concrete type such as `object` or `string`.
- A mismatch with the contract: `<c>.<e>: return type does not match the response schema` ([Route proof at r.contract()](#route-proof-at-rcontract)).

### Example
Compiled: [`docs/v1/examples/http/proposed/resources.ts`](./examples/http/proposed/resources.ts), with the contract mismatch at `r.contract()`. In the decided style (`params` needs H3 [#106](https://github.com/Laratypes/Laratype/issues/106) and H7 [#118](https://github.com/Laratypes/Laratype/issues/118)):
```ts
const UserResource = defineResource(User, (user) => ({
  id: user.id,
  name: user.name,
  email: when(user.isAdmin, user.email),
  posts: PostResource.collection(user.posts),
}));

class UserController {
  async show({ params }: Ctx<typeof users.show, { params: { user: User } }>) { return UserResource.make(params.user); }
}
```
Tests: [`packages/http/__tests__/resource/defineResource.test.ts`](../../packages/http/__tests__/resource/defineResource.test.ts), type tests (the contract mismatches): [`defineResource.test-d.ts`](../../packages/http/__tests__/resource/defineResource.test-d.ts).

### Non-goals
- No `mergeWhen`, `whenLoaded`, `additional` or `with` (wrapping) helpers.
- No wire-format typing: the client's `Jsonify` view of the response is H4 [#107](https://github.com/Laratypes/Laratype/issues/107).

### Open questions
- Resolved: the paginator is the plain `Page` of [database.md › Model](./database.md#model) ([#145](https://github.com/Laratypes/Laratype/issues/145)).

### Acceptance
[#123 Done when](https://github.com/Laratypes/Laratype/issues/123)

---

## Interceptors

### Status
merged @ 23ef6862 (PR [#415](https://github.com/Laratypes/Laratype/pull/415), H11 [#138](https://github.com/Laratypes/Laratype/issues/138)). Explicit
`r.interceptor()` registration on the `Route.api` builder and in `endpoints` callbacks; values only, no DI classes;
`withoutInterceptor` is not in this task. The `cache(ttl)` interceptor is the Cache package's
([services.md › Cache](./services.md#cache), [#166](https://github.com/Laratypes/Laratype/issues/166)).

### Public API
[`packages/http/src/interceptor/defineInterceptor.ts`](../../packages/http/src/interceptor/defineInterceptor.ts) ·
[`routing/api/types.ts`](../../packages/http/src/routing/api/types.ts) ·
[`routing/api/interceptorProof.ts`](../../packages/http/src/routing/api/interceptorProof.ts)

```ts
// @laratype/http: the six exports
function defineInterceptor(
  handle: <R>(ctx: Ctx<AnyEndpoint>, next: () => Promise<R>) => R | Promise<R>,
): Interceptor;
function defineInterceptor<E extends AnyEndpoint = never, Requires extends object = {}>(
  handle: InterceptorHandler<E, Requires>,
): Interceptor<E, Requires>;

/**
 * What a handler may return, and what next() resolves to: Result<E>, null for an endpoint without a response schema,
 * or a 0.5 Response/JsonResource.
 */
type Intercepted<E extends AnyEndpoint>;

/** The handler of an endpoint-pinned interceptor. `Requires` mirrors Ctx: middleware extensions and bound params. */
type InterceptorHandler<E extends AnyEndpoint = AnyEndpoint, Requires extends object = {}> = (
  ctx: Ctx<E, Requires>,
  next: () => Promise<Intercepted<E>>,
) => Intercepted<E> | Promise<Intercepted<E>>;

/** The defineInterceptor() value. The two overloads differ only in its type-only kind. */
type Interceptor<E extends AnyEndpoint = AnyEndpoint, Requires extends object = {}>;
type AnyInterceptor = Interceptor<any, any>;
function isInterceptor(value: unknown): value is AnyInterceptor;

interface ApiRouteBuilder<A, M extends readonly MiddlewareItem[] = [], B extends Record<string, Binder> = {},
                          I extends readonly AnyInterceptor[] = []> {
  interceptor<const W extends readonly AnyInterceptor[]>(...interceptors: W): ApiRouteBuilder<A, M, B, [...I, ...W]>;
  contract<C, K extends ControllerClass, P>(
    contract: C,
    controller: K & RouteProof<...> & InterceptorProof<A, C, I, ExtOf<M>, B>,
    options?: ContractRouteOptions<NoInfer<C>, P>,
  ): MountedContract<C, B>;
  scope<D extends ApiScopeDir<A>>(
    dir: D & ScopeInterceptorIssue<I, D>,                 // generic interceptors only (type-level)
    options: ScopeRouteOptions,
  ): MountedScope<D, B>;
  get: I extends readonly [] ? AdHocRouteMethod<"get"> : never;   // same for post / put / patch / delete
}

interface EndpointRouteBuilder<E extends AnyEndpoint = AnyEndpoint> {
  interceptor<const W extends readonly AnyInterceptor[]>(
    ...interceptors: W & EndpointInterceptorFit<E, W>
  ): EndpointRouteBuilder<E>;
}
```

`Intercepted` is the exported value type; its definition expands to `Result<E> | NoBody<E> | ResponseEscape`, where
`NoBody<E>` is `null` for an endpoint without a response schema. `InterceptorProof`, `ScopeInterceptorIssue` and
`EndpointInterceptorFit` are internal (not exported); the builder signatures show where those checks attach. The pinned
overload's `E` defaults to `never`, so a call without a type argument builds the generic form; pass the endpoint type to
pin it. `GenericInterceptorHandler` and the two value shapes behind `Interceptor` are internal too.

The generic overload comes first, so a call **without** a type argument builds the generic form and a call with the
endpoint type argument pins it:

```ts
const log = defineInterceptor((ctx, next) => next())                         // generic: mounts anywhere
const trim = defineInterceptor<typeof posts.show>(async (ctx, next) => {     // pinned to posts.show
  const value = (await next()) as Result<typeof posts.show>                 // the DTO arm of Intercepted<E>
  return { ...value, title: value.title.trim() }
})
```

`defineInterceptor()` freezes one `{ handle }` value with a `Symbol.for` brand (`INTERCEPTOR`) for both forms;
`isInterceptor()` recognizes either. The generic/concrete distinction (`__kind`) is a phantom in the types only.

### Invariants
- **Registration.** `r.interceptor(...)` before `.contract()` or `.scope()` applies to every contract mounted from that
  builder; in `r.contract(c, Ctrl, { endpoints: { show: (r) => r.interceptor(x) } })` it applies to that endpoint only.
  Contract and endpoint registration take both forms; a scope takes **generic** interceptors only (type-level, see
  Diagnostics). There is no app-wide registry: mount every contract from a builder that carries the interceptor, or from
  a scope. There is no `withoutInterceptor` in this task. An ad-hoc route has no contract response type, so a builder with
  interceptors cannot mount one (the type makes `get`/`post`/... `never`, and `Route.api` refuses it). 0.5 routes have no
  endpoint and take none.
- **Two forms.** The generic form is result-parametric, `<R>(ctx, next) => R | Promise<R>`: an interceptor can only pass
  through, or return, what `next()` gave it, so a cache hit needs an explicit `as R` cast and the dev response check is
  the runtime backstop. The endpoint-pinned form is checked at `r.contract()` against every endpoint it is mounted on:
  1. its returned value fits `Result<E> | NoBody<E> | ResponseEscape` (the response schema input; the client's
     `Jsonify<output>` type never changes);
  2. its `next()` accepts what the handler returns (`Intercepted<E>`);
  3. `Provided<E, Path, X, B>` (the ctx the route passes, bound models and middleware extensions included) extends
     `Ctx<IE, IReq>`.
  A pinned interceptor at contract level must fit every endpoint of the contract; use an `endpoints` callback when it fits
  one. A generic interceptor is skipped by the proof; `Interceptor` and `AnyInterceptor` describe the values,
  `InterceptorHandler` the pinned handler, and `Intercepted<E>` the value `next()` resolves to.
- **Order.** After global middleware, the auth guard (A2 [#120](https://github.com/Laratypes/Laratype/issues/120)), the
  throttle, the route middleware, model binding and input validation; after bindings and policies
  ([H8 #122](https://github.com/Laratypes/Laratype/issues/122)); before the handler. H8 settles the relative order of
  policies and validation; an interceptor runs after both. The first registered interceptor is outermost; `next()` runs
  the rest of the chain once, and a duplicate value runs once at its first position. Route order is the scope's (outer to
  inner), then the contract's, then the endpoint's.
- **Around the handler.** `next()` resolves to the handler's value (or the next interceptor's return), or rejects with
  what the handler or a later interceptor threw. Not calling `next()` skips the handler: that is the cache short-circuit.
  A second or concurrent `next()` is a `TypeError`. The interceptor gets the same ctx object the handler gets
  (`Ctx<E, Requires>`): the validated `query` and `body`, `params` with bound models, middleware extensions, and the
  read-only `endpoint`.
- **The final value.** The interceptor's return takes the handler's place and goes through the existing
  `resolveContractResponse` exactly as the handler's value: the endpoint's status, `JSON.stringify` serialization, the
  `ResponseEscape` rules (`Response`, `JsonResource`), and, in dev/test only, the response schema check. A value that
  does not match is the existing logged generic **500** (`the handler's value does not match...` /
  `...changes the handler's value...`); production sends it as before. No new error body or format is introduced.
- **Errors.** A throw from an interceptor goes through `checkUndeclaredError` (X3
  [#157](https://github.com/Laratypes/Laratype/issues/157)) and the exception filter. A declared `ContractError` answers
  its status and body; anything else is the existing dev/test 500 plus log (production rethrows). A handler or later
  interceptor throw rejects `next()`; the interceptor may catch it and return a value or throw another error; uncaught is
  the same path.
- **Scope rule is type-level only (amendment B).** `r.interceptor(concrete).scope(...)` is a compile error; there is no
  mount-time check for it. A cast (`as any`) can bypass it, and the dev response check is the runtime backstop. A generic
  interceptor mounted at a scope is applied to every contract under the folder at runtime; its type is not part of another
  builder's proof (the same limitation as H6 scope middleware).
- **A cache short-circuit skips the handler's checks.** When an interceptor returns without calling `next()`, every
  check made inside the handler is skipped, and the same value is replayed to every request that passes the route's
  auth and policies. Key the cache per user (or principal) when the value depends on the user, keep authorization in
  policies and middleware rather than in the handler, and never cache a `ResponseSupport` value that sets cookies: its
  headers, `Set-Cookie` included, are replayed too.
- **Values only.** No interceptor classes or container DI; a `cache(ttl)` factory from
  [@laratype/cache](./services.md#cache) (#166) returns a generic `defineInterceptor()` value.

### Diagnostics
Runtime `Error`s and `TypeError`s, prefixed `[@laratype/http]`:
- `defineInterceptor(): expected a function (ctx, next), got <typeof>` (a `TypeError` at definition)
- `Route.api: r.interceptor(): <value> is not an interceptor (a defineInterceptor(...) value)`
- `Route.api: contract "<name>": interceptors must be an array of defineInterceptor(...) values` (a hand-built item; the
  scope's wording is `scope "<dir>": ...`)
- `Route.api: contract "<name>": <value> is not an interceptor (a defineInterceptor(...) value)` (a hand-built item; the
  scope's wording is `scope "<dir>": ...`)
- `Route.api: r.<method>('<path>'): interceptors need a contract route (there is no endpoint response type to check)`
- `interceptor <name> called next() more than once` (a `TypeError`; `<name>` is the handle's function name, or
  `interceptor`)
- The response check's existing messages (`the handler's value does not match the endpoint's response schema (...)`,
  `the endpoint's response schema changes the handler's value ...`) apply to the interceptor's value as the handler's
  replacement (dev and test only, logged, 500).

Type-level:
- `Route.api: scope "<folder>": interceptor is endpoint-specific; mount it on r.contract() or an endpoint` (on the
  `scope()` folder argument; a cast bypasses it)
- `<c>.<e>: interceptor result does not match the response schema` with `{ expected; got }`
- `<c>.<e>: interceptor's next() does not accept the handler's result` with `{ handler_returns; interceptor_next }`
- `<c>.<e>: interceptor does not accept the handler's ctx` with `{ route_provides; interceptor_requires }`
- `endpoint callback: interceptor result does not match the response schema` and
  `endpoint callback: interceptor's next() does not accept the handler's result` (an `endpoints` callback; the callback
  checks the response, not the route's bindings or extensions)
- A pinned `defineInterceptor<E>` whose handler returns another shape is a normal TS return error at the definition; a
  generic interceptor cannot return an arbitrary shape (it needs `as R`)
- `r.interceptor(...)` makes `get`, `post`, `put`, `patch` and `delete` `never` on that builder (no ad-hoc route)

### Example
```ts
const log = defineInterceptor((ctx, next) => {
  const started = Date.now()
  return next().then((value) => {
    console.log(ctx.endpoint.def.method, ctx.endpoint.def.path, Date.now() - started)
    return value
  })
})

// a public, user-independent value: key per user when the value depends on the user (Invariants › cache short-circuit)
const cache = new Map<string, unknown>()
const cached = defineInterceptor(async <R>(ctx: Ctx<AnyEndpoint>, next: () => Promise<R>): Promise<R> => {
  const post = (ctx.params as Record<string, string | undefined>).post
  const key = `${ctx.endpoint.def.path}:${String(post)}`
  const hit = cache.get(key) as R | undefined          // the visible cast the generic form needs
  if (hit !== undefined) return hit
  const value = await next()
  cache.set(key, value)
  return value
})

const trim = defineInterceptor<typeof posts.show>(async (_ctx, next) => {
  // a 0.5 Response/JsonResource is the other arm of Intercepted<E>; this route returns the DTO
  const value = (await next()) as Result<typeof posts.show>
  return { ...value, title: value.title.trim() }        // still the response schema's type
})

Route.api(appApi, (r) => [
  r.interceptor(log).contract(posts, PostController, {
    endpoints: { show: (r) => r.interceptor(cached, trim) },
  }),
])
```

Tests: [`packages/http/__tests__/routing/interceptors.test.ts`](../../packages/http/__tests__/routing/interceptors.test.ts)
(transform, cache short-circuit, logging/order, validation and binding order, multiple interceptors and scope order,
declared and undeclared errors, a second `next()`, a response-schema mismatch, bodyless endpoints, mount errors, edge
inputs) and [`interceptors.test-d.ts`](../../packages/http/__tests__/routing/interceptors.test-d.ts) (the two forms, the
result-parametric generic, the scope-only error, the proof checks, the cast cache hit). Compiled example:
[`docs/v1/examples/http/proposed/interceptors.ts`](./examples/http/proposed/interceptors.ts).

### Non-goals
- No cache store and no `cache(ttl)`: [@laratype/cache](./services.md#cache) (#166) provides the interceptor value.
- No interceptor classes or container DI: values only, as for H6's `defineMiddleware()`.
- No app-wide registry: mount from a builder or a scope.
- No `withoutInterceptor` in this task; no removal of an inherited scope interceptor.
- No ad-hoc or 0.5 route: they have no endpoint response type.
- No context extension from an interceptor: use H6 typed middleware.
- No auth guard or policy execution here: A2 [#120](https://github.com/Laratypes/Laratype/issues/120), A3
  [#121](https://github.com/Laratypes/Laratype/issues/121) and H8 [#122](https://github.com/Laratypes/Laratype/issues/122).

### Acceptance
[#138 Done when](https://github.com/Laratypes/Laratype/issues/138)

---

## Ad-hoc routes

### Status
proposed: PR [#306](https://github.com/Laratypes/Laratype/pull/306) @ 9df674f ([#139](https://github.com/Laratypes/Laratype/issues/139), H12). A string body is `text/plain; charset=utf-8` with `nosniff`, and an explicit, non-blank `Content-Type` on a `Response` is kept: merged @ e8633c9 (PR [#384](https://github.com/Laratypes/Laratype/pull/384)) ([#336](https://github.com/Laratypes/Laratype/issues/336), H41). `.name()` proposed: PR [#391](https://github.com/Laratypes/Laratype/pull/391) @ 952dae91 ([#162](https://github.com/Laratypes/Laratype/issues/162), H13). `Route.prefix(...)` and `group(...)` are planned → [#321](https://github.com/Laratypes/Laratype/issues/321). Typed middleware on an ad-hoc route, and `MountedRoute.middleware` as `MiddlewareItem[]`: PR [#352](https://github.com/Laratypes/Laratype/pull/352) @ fd69458 (H6 [#117](https://github.com/Laratypes/Laratype/issues/117)).

### Public API
[`packages/http/src/routing/api/types.ts`](https://github.com/Laratypes/Laratype/blob/fd6945817092f47f7af620409c1354f97e17a3b5/packages/http/src/routing/api/types.ts) · [`packages/http/src/routing/api/ApiRouter.ts`](https://github.com/Laratypes/Laratype/blob/fd6945817092f47f7af620409c1354f97e17a3b5/packages/http/src/routing/api/ApiRouter.ts)

```ts
type AdHocMethod = "get" | "post" | "put" | "patch" | "delete";

// r.get / r.post / r.put / r.patch / r.delete of ApiRouteBuilder<A>
type AdHocRouteMethod<M extends AdHocMethod> = <const P extends `/${string}`, R>(
  path: P, handler: (req: Request, params: PathParams<P>) => R | Promise<R>) => MountedRoute<M, P, R>;

interface MountedRoute<
  M extends AdHocMethod = AdHocMethod,
  P extends string = string,
  R = unknown,
  N extends string | undefined = undefined,       // the .name(), H13 #162
> {
  readonly kind: "route";
  readonly method: M;
  readonly path: P;
  handler(req: Request, params: PathParams<P>): R | Promise<R>;
  readonly middleware: readonly MiddlewareItem[];   // 0.5 classes and typed middleware, in order
  readonly routeName: N;
  name<const Name extends string>(name: Name): MountedRoute<M, P, R, Name>;   // a new frozen route
}

interface AdHocRouteEntry {                      // ApiRoutes.adHoc, and the registry
  readonly method: AdHocMethod;
  readonly path: string;
  readonly name: string | undefined;             // the .name() (H13 #162)
  readonly controller: undefined;
  readonly handler: MountedRoute["handler"];
  readonly middleware: readonly MiddlewareItem[];   // 0.5 classes and typed middleware, in order
  readonly domain: string | undefined;
}
```

`Request` is the 0.5 request class a 0.5 (`Route.group`) controller method gets; a contract route's handler gets the ctx instead ([Controller typing](#controller-typing-ctx-and-controllerof)), and `PathParams` is the contract's path param type ([contract.md](./contract.md)). `RequestKernel.handle()` takes `KernelRouteParams`, the 0.5 `RouteParams` or an `AdHocRouteParams` (`RouteParams` without a controller, with the `handler`), so the 0.5 `RouteParams` keeps its required `controller`. The `.name()` declarations (H13 [#162](https://github.com/Laratypes/Laratype/issues/162)) are [`MountedRoute.routeName` / `MountedRoute.name()` @ 952dae91](https://github.com/Laratypes/Laratype/blob/952dae91/packages/http/src/routing/api/types.ts#L131-L137) and [`AdHocRouteEntry.name` @ 952dae91](https://github.com/Laratypes/Laratype/blob/952dae91/packages/http/src/routing/api/types.ts#L319).

### Invariants
- **In `Route.api`.** An ad-hoc route is an item of the `Route.api(appApi, (r) => [...])` callback, next to the contract routes: `r.get('/health', () => 'ok')`. The group still mounts every contract of the tree. `r.middleware(...)` before `.get()` applies to that route (duplicates removed).
- **Path as written.** The path starts with `/` (a type error and a runtime error otherwise) and is served as written, in Hono's route syntax: it takes no folder or prefix.
- **One route per method and path.** Hono answers with the first of two routes with the same method and path, so an ad-hoc route that repeats a contract route or another ad-hoc route of the group is a runtime error in `Route.api`. Param names don't count (`/items/:item` repeats `/items/:id`), a last optional param counts as both its routes (`/items/:id?` repeats `/items` and `/items/:id`), and a param pattern or a trailing slash makes another route. Routes of other groups are not checked (as for the registration order).
- **Inferred types.** `params` comes from the path (`'/hello/:name'` gives `{ name: string }`, `:id?` an optional key, `:id{[0-9]+}` the key `id`), and `R` from what the handler returns (an async handler's `Promise<R>` gives `R`). `R` types nothing at runtime: the response is not validated.
- **The 0.5 request and response.** `RequestKernel.handle` parses the body as for a contract route (a malformed JSON or form body is the 400 of [validation.md › Pipeline validation and 422](./validation.md#pipeline-validation-and-422)), then runs the route middleware, then the handler with the 0.5 request and the raw path params (no model binding, no contract validation, no ctx). Its result goes through the 0.5 response path, not [Response from the contract](#response-from-the-contract): a string as `text/plain; charset=utf-8` with `nosniff` (never HTML; an explicit, non-blank `Content-Type` on a `Response` is kept, so `text/html` is how a handler sends HTML, H41 [#336](https://github.com/Laratypes/Laratype/issues/336)), no content as an empty body, and every other value as `application/json` with `nosniff`, as for a 0.5 controller method ([The 0.5 response](#the-05-response)). The status is 200 unless it returns a `Response` (`@laratype/http`) with its own status: there is no controller method, so no status decorator or method-name guess (`store` → 201) applies.
- **Not a contract route.** An ad-hoc route has no contract, endpoint, schema, capabilities or policies. It is in `ApiRoutes.adHoc`, never in `ApiRoutes.routes` or `apiRoutes(appApi)`, so it is **excluded from OpenAPI and from the generated types** ([typegen.md](./typegen.md)), and never in the not-enforced warning; its `.name()` only feeds `route()` ([Route names and URLs](#route-names-and-urls)) and `sauf route:list`.
- **Registration order.** `mount()` sorts the ad-hoc and the contract routes of a group together, by specificity ([Router v2](#router-v2)): `r.get('/api/users/me', ...)` is reached before a contract's `/api/users/:id`. A more specific ad-hoc route takes those requests from a contract route: `r.get('/api/users/:id{[0-9]+}', ...)` answers `GET /api/users/7` instead of `users.show`.
- **No scope.** An ad-hoc route is outside the contract tree, so it gets no scope middleware or policy, even when its URL is under a scope folder's path (`/api/users/:user/export`): only the middleware of its own builder (`r.middleware(Auth).get(...)`).
- **Domain and registry.** `.domain()` applies to the ad-hoc routes too. `mount()` returns the contract entries, then the ad-hoc ones; `sauf route:list` shows an ad-hoc route with the controller `Closure`.

### Diagnostics
Type errors (`packages/http/__tests__/routing/adHocRoutes.test-d.ts`):
- a path without a leading `/`: `` TS2345: Argument of type '"health"' is not assignable to parameter of type '`/${string}`'. ``
- a param name not in the path: `TS2339: Property 'slug' does not exist on type '{ id: string; }'.`

Runtime `Error`s, prefixed `[@laratype/http] Route.api: `:
- `r.<method>('<path>'): the path must start with "/"`
- `r.<method>('<path>') needs a handler function`
- `r.<method>('<path>') is the same route as <route name>` (a contract route of the group)
- `r.<method>('<path>') is the same route as another r.<method>('<path>')`

### Example
```ts
export const apiRoutes = Route.api(appApi, (r) => [
  r.contract(users, UserController),
  r.get('/health', () => 'ok'),
  r.middleware(Audit).get('/hello/:name', (req, { name }) => ({ hello: name })),
])
```
Tests: [`packages/http/__tests__/routing/adHocRoutes.test.ts`](../../packages/http/__tests__/routing/adHocRoutes.test.ts) and [`adHocRoutes.test-d.ts`](../../packages/http/__tests__/routing/adHocRoutes.test-d.ts).

### Non-goals
- No names in OpenAPI or typegen: `.name()` only feeds `route()` and `sauf route:list` (H13 [#162](https://github.com/Laratypes/Laratype/issues/162)).
- No `Route.prefix(...)` or `group(...)` yet: planned → [#321](https://github.com/Laratypes/Laratype/issues/321).
- No response or input validation: an ad-hoc route has no schema.

### Open questions
- None recorded.

### Acceptance
[#139 Done when](https://github.com/Laratypes/Laratype/issues/139)

---

## Route names and URLs

### Status
proposed: PR [#391](https://github.com/Laratypes/Laratype/pull/391) @ 952dae91 (H13 [#162](https://github.com/Laratypes/Laratype/issues/162), M3). `route()`, `redirect().route()` and `.name()`; every path and query is built with [`buildUrl`](./contract.md#url-builder). The app URL is `config('config.url')`, the 0.5 single config file; the K1 [#152](https://github.com/Laratypes/Laratype/issues/152) file split (`app/config/app.ts`, `config('app.url')`) is followed up there. The model base gaining `getRouteKey()` is folded into H14 [#163](https://github.com/Laratypes/Laratype/issues/163).

### Public API
[`packages/http/src/routing/routeUrl.ts`](https://github.com/Laratypes/Laratype/blob/952dae91/packages/http/src/routing/routeUrl.ts) · [`packages/http/src/supports/helpers.ts`](https://github.com/Laratypes/Laratype/blob/952dae91/packages/http/src/supports/helpers.ts) · [`packages/http/src/routing/api/types.ts`](https://github.com/Laratypes/Laratype/blob/952dae91/packages/http/src/routing/api/types.ts)

```ts
// The app registers its routes once, by module augmentation (the config() / auth Register pattern), next to Route.api:
declare module '@laratype/http' {
  interface Register { routes: typeof apiRoutes }
}

export interface Register {}
export interface RouteKeyed { getRouteKey(): string | number | bigint }
export interface RouteUrlOptions<Query = object> { readonly query?: Query; readonly absolute?: boolean }
export type RouteParamValue = string | number | bigint | RouteKeyed
export type RouteName<R = Register>;                 // contract names | the ad-hoc .name()s; string without a registration
export type RouteParamsOf<Name extends string, R = Register>;   // the full path's params; a path without params takes no key
export type RouteQueryOf<Name extends string, R = Register>;    // the endpoint's query schema input
export type RouteArgs<Name extends string, R = Register>;       // [params, options?], params required only with a required param
export function route<const Name extends RouteName>(name: Name, ...args: RouteArgs<Name>): string

// Ad-hoc routes (H12 #139): MountedRoute gains the name and the `name()` builder
interface MountedRoute<M extends AdHocMethod, P extends string, R, N extends string | undefined = undefined> {
  readonly routeName: N;
  name<const Name extends string>(name: Name): MountedRoute<M, P, R, Name>;
}
interface AdHocRouteEntry { readonly name: string | undefined }   // was `undefined`

// @laratype/http, next to the 0.5 redirect(url, status?) which keeps its signature
export interface RedirectRouteBuilder {
  route<const Name extends RouteName>(name: Name, ...args: RouteArgs<Name>): Response;   // the 0.5 response
}
export function redirect(httpStatusCode?: RedirectStatusCode): RedirectRouteBuilder
export function redirect(url: string, httpStatusCode?: RedirectStatusCode): Response
```

### Invariants
- **Names.** `route()` resolves a name against the routes `Route.api()` mounted in this process: every contract route (`users.posts.update`, the tree name plus the endpoint key, [contract.md › Contract folder tree](./contract.md#contract-folder-tree)) and every ad-hoc route named with `.name()`. `Route.api()` fills the registry, and a second call merges its names: a contract route mounts again without an error, its name pointing at the path the latest group mounts (the same tree, so the same path in an app), and a named ad-hoc route of another group is added. `route()` before any `Route.api()` throws. A name must be a string: a non-string throws before the registry lookup, naming only its type. Untyped code passing a request value, a JSON body value such as `{ length: 1e9 }` included, never has its length read.
- **One group in the types.** `Register.routes` holds one `Route.api()` group, whose contract names and ad-hoc `.name()`s type `route()`; the app registers the group it calls `route()` from. The runtime registry merges the other groups' names all the same.
- **One name, one route.** An ad-hoc name maps to one method and path: a second ad-hoc route with the name and a different method or path (in this group or a later `Route.api()` call), or an ad-hoc name a contract route has, is an error; so is a contract route whose name an ad-hoc route of an earlier call took. The same group mounting again in one process (an `--hmr` restart) registers the same route, not a duplicate. `Route.api()` checks the whole group (duplicate names included) before it registers any of its names: a group that fails `Route.api()` leaves nothing behind, so `route()` cannot build a URL for a group that never registered. The names are registered before `Route.api()` returns, and a later `.domain()` or `.mount()` failure (`.domain('not a host')`, a handler `mount()` refuses) does not roll them back: `route()` can then build the URL of a group the app does not serve.
- **Relative by default.** `route()` returns the mounted path (`/api/users/1/posts/2?page=2`); `{ absolute: true }` appends it to `config('config.url')` (`https://app.test/api/users/1/posts/2`). The config value is an http(s) URL whose origin and path are used (a `URL` value is accepted): no query, hash or credentials, and its trailing slashes are dropped. The path is appended to the config's own path, so a base path stays on every route, the root route `/` included: with `https://app.test/sub/`, the root route builds `https://app.test/sub/` and a query never changes the pathname. The request's `Host` and `X-Forwarded-Host` headers never reach an absolute URL: the config value is the only origin source.
- **No host from `.domain()`.** `route()` ignores the group's `.domain()`: the URL is a path relative to the current host, or with `{ absolute: true }` a URL under `config('config.url')`, never the domain the route is served on. A contract name mounted by several groups builds the path of the latest mount.
- **Params** are typed from the full path, parent `[x]` folders included, and take a `string`, a `number`, a `bigint`, or a model: a `RouteKeyed` value contributes its `getRouteKey()`, and a bigint value (direct, or the route key) is converted with `String()` before `buildUrl` encodes it, so DB1 [#145](https://github.com/Laratypes/Laratype/issues/145)'s bigint keys keep their digits. A path without params takes no key at all (an omitted `params` and an explicit `{}` stay valid), so a typo is a type error. A `/` is `%2F` by default; a regex param whose pattern needs a literal `/` (`:file{.+/.+}`) is split per segment, each segment encoded on its own, so the route the server mounts matches; a top-level `|` in a pattern throws only when the split would be sent and Hono's two routers read it differently (`a|.+/.+` with `admin/all`), while a value without `/` keeps the encoded form; a split that is used refuses an empty, `.` or `..` segment, while a value the pattern rejects in both forms keeps the encoded one and 404s. A pattern Hono cannot route (a `}` before a `/`, `:f{a{2}/x}`) throws, naming the path. A `*` wildcard segment cannot be built: `route()` throws `buildUrl`'s `has a "*" segment` error for a named wildcard route, at any call, since the path is the route's own. At the model layer ([database.md › BindableModel](./database.md#bindablemodel)) the route key is the property the model class's `routeKeyName` names, or `primaryKey`; H14 [#163](https://github.com/Laratypes/Laratype/issues/163) adds `getRouteKey()` to the model base, so until then a model instance with the method (or any object with it) passes. An object param without it throws.
- **Query** is typed from the endpoint's query schema **input**, as the client types it; an endpoint without a query schema takes no `query` (`query?: undefined`). An ad-hoc route has no schema, so its query is `object`. `buildUrl` takes flat values only and its query must be a plain object of keys (a `null` prototype or any realm's `Object.prototype`), so an array, a `Map`, a `Date` or a class instance throws (plainness is a runtime check; the type cannot express it), and a schema input with a nested object throws `buildUrl`'s `query "<key>"` error at build ([contract.md › URL builder](./contract.md#url-builder)).
- **One encoder.** `buildUrl` fills the path and serializes the query: params with `encodeURIComponent` (per segment only when the pattern needs a literal `/`), the query with `URLSearchParams` (`undefined` and `null` skipped, an array repeats its key, a `Date` as ISO 8601). `route()` never concatenates a value into a URL itself, and `buildUrl`'s diagnostics propagate unchanged.
- **Route patterns cost.** `buildUrl` runs a param's pattern against a value: the encoded form always, then the split when the value holds `/` and the encoded form is rejected. `route()` and `redirect().route()` therefore spend on a request-derived value about what Hono's own match spends: a catastrophic (exponential) pattern costs there too, so keep route patterns linear.
- **`.name()` is immutable.** It returns a new frozen route with `routeName` set and leaves the route it is called on unchanged. A name is a non-empty string.
- **`redirect().route()`** redirects to the same URL, relative by default like `route()`, with `{ absolute: true }` to opt in: a relative `Location` is valid (RFC 9110 §10.2.2), and an absolute default would throw on every app without a `url`. A relative `Location` stays on the request origin; `{ absolute: true }` uses the `config('config.url')` origin, which can differ from the request origin (an app URL, never a request header). It resolves any registered name, so never pass a request value as the name without an allowlist: `redirect().route(req.query.to)` reaches every named route. Take the name from a fixed list.
- **Server-side.** `route()` is for the server; the FE builds URLs with `@laratype/client` (CL1) over the same `buildUrl`. A name is not added to OpenAPI or typegen: an ad-hoc route stays out of both.

### Diagnostics
Runtime `TypeError`s, prefixed `[@laratype/http] `:
- `route: a route name is a string, got <typeof>` (the type alone, never the value)
- `route: no routes are registered (call Route.api(appApi, ...) first)`
- `route: unknown route name "<name>"` (a name longer than 100 code points is cut to 100 plus `…`, from a bounded prefix: a huge name is never read whole)
- `route: param "<name>" got an object that is not a model (no getRouteKey())`
- `route: absolute URLs need config('config.url') (app.url), which is not set`
- `route: config('config.url') must be an absolute http(s) URL`
- `route: config('config.url') must not contain a query`
- `route: config('config.url') must not contain a hash`
- `route: config('config.url') must not contain credentials` (none of these echoes the config value: an operator's credentials never reach a log)
- `Route.api: r.get('/x').name("<name>") is already the name of <route>` (a contract route name, or `r.get('/path')` of the ad-hoc route that has it)
- `Route.api: contract "<name>" has the name of r.get('/path')`
- `Route.api: r.get('/x').name() needs a name, a non-empty string`

From `buildUrl` ([contract.md › URL builder](./contract.md#url-builder)), unchanged: `buildUrl: missing param "<name>" for "<path>"`, `buildUrl: param "<name>" for "<path>" must be a string or a number, got <typeof>`, `buildUrl: param "<name>" for "<path>" cannot be "." (a dot segment)`, `buildUrl: param "<name>" for "<path>" has an empty segment`, `buildUrl: param "<name>" for "<path>" has a "." or ".." segment (a dot segment)`, `buildUrl: param "<name>" for "<path>" has an unpaired surrogate`, `buildUrl: path "<path>" has a "*" segment, which buildUrl cannot fill`, `buildUrl: "<path>" builds "<result>", which a URL reads as another host`, `buildUrl: query "<key>" must be a string, number, boolean, bigint or Date, or an array of them`.

New in this PR (C8 [#253](https://github.com/Laratypes/Laratype/issues/253)): `buildUrl: param "<name>" for "<path>" has a pattern with "}" before "/", which Hono cannot route`; `buildUrl: param "<name>" for "<path>" has a pattern Hono's two routers read differently for this value, so the URL depends on the app's router`; `buildUrl: query must be a plain object of keys, got <Array | Map | URLSearchParams | Date | Class | an object | typeof>`.

Type errors, in [`route.test-d.ts`](../../packages/http/__tests__/routing/route.test-d.ts): an unknown name, a tree node used as a name, an ad-hoc route without `.name()`, a missing required param, an unknown param (on a path with no params too: `route('health', { typo: 'x' })` is an error), a param value that is not a string, number, bigint or `RouteKeyed`, a query key the endpoint's schema does not have, and `query` on an endpoint without a query schema.

### Example
[`examples/http/proposed/route-names.ts`](./examples/http/proposed/route-names.ts):

```ts
// app/routes/api.ts: the group route() reads, registered next to it
export const apiRoutes = Route.api(appApi, (r) => [
  r.contract(posts, PostController),
  r.get('/health', () => 'ok').name('health'),
])
// app/declare/routes.d.ts
declare module '@laratype/http' { interface Register { routes: typeof apiRoutes } }

route('users.posts.index', { user }, { query: { page: 2 } })                    // "/api/users/ada/posts?page=2"
route('users.posts.show', { user: new User('ada'), post }, { absolute: true })  // "https://app.test/api/users/ada/posts/7"
redirect().route('users.posts.show', { user, post })                           // Location: "/api/users/ada/posts/7"
```

### Non-goals
- No client change: `@laratype/client` keeps building its own URLs with `buildUrl`.
- No generated `Register`: the app writes the `declare module` block; `sauf types:generate` emitting it is a follow-up.
- No type-level duplicate-name check: a duplicate is a `Route.api()` runtime error.
- No `.name()` in `apiPaths()`, `apiRoutes()`, OpenAPI or typegen: an ad-hoc route stays out of them.
- No model instance method here: `getRouteKey()` is H14 [#163](https://github.com/Laratypes/Laratype/issues/163)'s to add to the model base.

### Open questions
- The type-level pairing of a union-valued name with its required params (a `'health' | 'users.show'` value makes the params optional) → [#163](https://github.com/Laratypes/Laratype/issues/163)

### Acceptance
[#162 Done when](https://github.com/Laratypes/Laratype/issues/162)

---

## CORS

### Status
proposed: PR [#386](https://github.com/Laratypes/Laratype/pull/386) @ [c40f616](https://github.com/Laratypes/Laratype/commit/c40f616) (H15 [#164](https://github.com/Laratypes/Laratype/issues/164)).

### Public API
`app/config/cors.ts`, an optional config file like any other (K1 [#152](https://github.com/Laratypes/Laratype/issues/152)): a default-exported `defineConfig({...})`, read once at boot. `CorsConfig`, exported from `@laratype/http`, types it: the fields are Hono 4.13.17's `CORSOptions`, readonly, plus `paths`. Code: [`middleware/cors.ts` @ c40f616](https://github.com/Laratypes/Laratype/blob/c40f616/packages/http/src/middleware/cors.ts).

```ts
// @laratype/http
export type CorsConfig = {
  readonly paths?: readonly string[]
  readonly origin: string | readonly string[] | ((origin: string, c: Context) => Promise<string | undefined | null> | string | undefined | null)
  readonly allowMethods?: readonly string[] | ((origin: string, c: Context) => Promise<string[]> | string[])
  readonly allowHeaders?: readonly string[]
  readonly exposeHeaders?: readonly string[]
  readonly maxAge?: number
  readonly credentials?: boolean
}
```

```ts
// app/config/cors.ts
import { defineConfig } from '@laratype/core'
import type { CorsConfig } from '@laratype/http'

export default defineConfig<CorsConfig>({
  paths: ['/api/*'],                                       // Hono path patterns; default ['*'], every path
  origin: ['https://app.example.com'],                     // required: a string, a list, or a function
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], // default GET, HEAD, PUT, POST, DELETE, PATCH, QUERY
  allowHeaders: ['Content-Type', 'Authorization'],         // default: echoes Access-Control-Request-Headers
  exposeHeaders: ['X-Request-Id'],                         // default: none
  maxAge: 600,                                             // seconds: a whole number of 0 or more; default none
  credentials: true,                                       // default false
})
```

Every key but `origin` is optional: a file that turns CORS on has to say who may call.

### Invariants
- **Opt-in:** no `app/config/cors.ts` means no CORS middleware and no CORS headers, so only same-origin calls work; that is the framework's default. The file's presence is the switch. There is no `false`: delete the file to turn CORS off.
- **Hono does the CORS work.** The middleware is `cors()` from `hono/cors`, and the file maps onto its options (`origin`, `allowMethods`, `allowHeaders`, `exposeHeaders`, `maxAge`, `credentials`), so origin matching, the preflight answer (204, with `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers` and `Access-Control-Max-Age` as configured or requested) and every header set are Hono's. Hono 4.13.17's default `allowMethods` is `GET, HEAD, PUT, POST, DELETE, PATCH, QUERY`. An origin is matched exactly against the browser's `Origin` header (no trailing slash); a list allows each of its entries; a function answers the origin to echo, or `null`/`undefined` to refuse. `'*'` is the whole-origin form: a list holding a `'*'` entry fails the boot, because Hono matches a list by `includes` and a browser never sends `'*'` as its origin.
- **Mounted first, at boot.** `RequestKernel.boot()` registers the middleware on the Hono app before the app providers mount their routes (`Route.api(...).mount(app)`), so it runs before routing and before the pipeline reads the body ([Request pipeline](#request-pipeline)). A preflight is answered by the middleware itself, before any route matches: a contract, 0.5 or ad-hoc route needs no `OPTIONS` handler, and the body is never read on one.
- **`paths`:** Hono path patterns (`'/api/*'`, `'*'`); the default `['*']` covers every path. One middleware serves the whole list, its path matched by a Hono `TrieRouter` built from it (a separate instance from the app's router, so a pattern reads as `TrieRouter` reads it), so a request under two overlapping patterns (`['/api/*', '/api/users/*']`) still runs `cors()` once. A request outside the list gets no CORS headers, and its preflight is the app's own `OPTIONS` answer or Hono's 404. `paths: []` is invalid at boot, not "no path".
- **Every answer carries the headers, an error too.** Hono sets them on the context's header store before `next()`, and the exception filter keeps the context headers, so 401, 404 (Hono's and a contract error's), 413, 422, 429 (the contract's rate limit included, #319) and the exception filter's generic 500 carry them. Two answers do not: a request outside `paths`, and the generic 500 of a non-`Error` throw, built by the boot `fetch` wrapper ([Exceptions](#exceptions) › Non-`Error` throws).
- **Exposed headers:** a browser hides every response header from a cross-origin client except the CORS-safelisted ones. `Location` and `Content-Location` on a 201 are not safelisted, so an app whose frontend reads them lists both in `exposeHeaders` (H32 [#312](https://github.com/Laratypes/Laratype/issues/312)). `Retry-After` on a 429 is not safelisted either: a frontend that reads it lists it in `exposeHeaders` (H34 [#319](https://github.com/Laratypes/Laratype/issues/319)).
- **A refused origin is not an error.** The route still runs and answers its own response (the preflight its 204), without `Access-Control-Allow-Origin`: a browser hides the response and another client reads it, because CORS is enforced by the browser, not the server.
- **A function origin must allowlist.** The function gets the request's `Origin` header (`""` when the request has none) and must compare it against an allowlist of its own, answering the origin to echo or `null`/`undefined` to refuse: returning the incoming value unchecked allows every site.
- **`'null'` is refused.** As the string origin or as a list entry, `'null'` fails the boot: it is the origin a sandboxed iframe, a `data:` page and a `file:` page send, so it would allow every one of them.
- **An origin must be serialized.** An entry that is not `http(s)://host[:port]` as a browser writes it (no path, trailing slash or query) fails the boot: Hono compares it to the `Origin` header by exact string, so it would silently never match.
- **`Vary`:** for an origin that is not `*`, every answer's `Vary` lists `Origin`, appended to whatever the response already has (a handler's own `Vary`, a raw `Response` included, is kept) and never twice (`Vary: *` covers it), so a shared cache does not serve one origin's answer to another. Hono 4.9.6 built `Vary` from the REQUEST's own header and dropped `Origin`; 4.13.17 appends `Origin` to the response itself (fixed in 4.10.3, re-checked on this bump), and `mountCors` still appends it to the final response so the wrapper covers Hono < 4.10.3, which the `hono` peer floor (`^4.8.0`) still allows: it can go once the floor is `>= 4.10.3` → B28 [#369](https://github.com/Laratypes/Laratype/issues/369); a preflight also appends `Access-Control-Request-Headers` when it sets `Access-Control-Allow-Headers`.
- **Wildcard and credentials:** `credentials: true` with `origin: '*'` fails the boot. Hono would send `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`, which a browser refuses on a credentialed request, so every call from the frontend would fail with no server-side sign. The function form is not checked at boot: it may answer a real origin.
- **Read once:** the file is read at boot, so a dev restart picks up a change; nothing re-reads it per request.

### Diagnostics
A `cors` value the framework refuses fails the boot with one `TypeError` listing every problem, `[@laratype/http] Invalid CORS config (app/config/cors.ts), <n> problems:`, then one `- <key>: <problem>` line each:

```
[@laratype/http] Invalid CORS config (app/config/cors.ts), 2 problems:
- maxAge: expected a whole number of seconds, 0 or more, got -1
- credentials: true cannot pair with origin '*'; list the origins instead
```

- a file that is not an object: `- expected defineConfig({ ... }), got false`
- `paths`: `- paths: expected a non-empty array of path patterns ('*' or a path starting with '/'), got []`, `- paths[0]: expected a path pattern ('*' or a path starting with '/'), got "api/*"`
- `origin`: `- origin: required; name the origins, or '*'`, `- origin: expected '*' or an origin string, a list of them, or a function, got 42`, `- origin[1]: expected a non-empty origin string, got 7`, `- origin[0]: '*' cannot be a list entry; set origin: '*' for every origin, or list them`, `- origin: 'null' allows sandboxed and file: pages; list real origins`, `- origin[0]: expected a serialized origin (http(s)://host[:port]), got "https://app.example.com/"`
- `allowMethods`: `- allowMethods: expected an array of HTTP method names or a function, got "GET"`, `- allowMethods[1]: expected an HTTP method name, got ""`
- headers: `- allowHeaders: expected an array of header names, got "Content-Type"`, `- exposeHeaders[0]: expected a header name, got ""`
- `maxAge`: `- maxAge: expected a whole number of seconds, 0 or more, got 1.5`
- `credentials`: `- credentials: expected a boolean, got "true"`
- an unknown key: `- 'credential': unknown key (expected paths, origin, allowMethods, allowHeaders, exposeHeaders, maxAge, credentials)`

### Example
[`examples/basic/app/config/cors.ts`](../../examples/basic/app/config/cors.ts) allows `http://localhost:5173`, the Vite dev server a separate frontend runs on, on `/api/*`, with credentials. Runtime tests: [`packages/http/__tests__/middleware/cors.test.ts`](../../packages/http/__tests__/middleware/cors.test.ts) (an allowed and a refused origin, the preflight and an actual request, credentials, exposed headers, 401/404/413/422/429/500 with the headers, the 429 of the contract's throttle with `Vary: Origin`, `Cache-Control: no-store` and an exposed `Retry-After` (#319), the `Vary` fix on an actual, an error and a preflight answer, on a handler's own `Vary` and on a raw `Response`'s `Vary`, the `paths` scope and an overlap, no config, a throwing config read, every diagnostic). Type test: [`cors.test-d.ts`](../../packages/http/__tests__/middleware/cors.test-d.ts).

### Non-goals
- No per-route CORS options and no `cors()` of its own to mount on one route: the config is app-wide. Hono's `cors()` is not a `MiddlewareItem`, so `r.middleware(cors())` fails `Route.api`; an app that needs another policy mounts Hono's `cors()` on the app for a path pattern, before the routes. That also decorates a throttle 429, which a route middleware never sees: the limit runs at `mount()`, before the kernel ([Rate limiting](#rate-limiting) › Response, #319).
- No origin globbing (`https://*.example.com`): Hono compares strings exactly; the function form matches a pattern in app code.
- No `credentials: true` with a `*` origin.
- No re-read of the file per request.

### Open questions
- When can the `Vary` wrapper go, once the `hono` floor is >= 4.10.3? → B28 [#369](https://github.com/Laratypes/Laratype/issues/369)

### Acceptance
[#164 Done when](https://github.com/Laratypes/Laratype/issues/164)

---

## Undeclared-error check

### Status
proposed: PR [#392](https://github.com/Laratypes/Laratype/pull/392) @ [bc10401](https://github.com/Laratypes/Laratype/commit/bc10401) (X3 [#157](https://github.com/Laratypes/Laratype/issues/157), M4). It replaces the earlier `--strict-contract` dev mode. Checking the handler's output against the response schema is [Response from the contract](#response-from-the-contract) › Dev-mode output validation (H4 [#107](https://github.com/Laratypes/Laratype/issues/107)), not this section.

### Public API
No new API, and no flag: `RequestKernel.handle` checks each thrown error in the catch of its route pipeline ([`request/Request.ts` @ bc10401](https://github.com/Laratypes/Laratype/blob/bc10401/packages/http/src/request/Request.ts)) against the route's resolved errors, which `Route.api` passes from `apiRoutes()` (`RouteEntry.errors`). The check is always on in dev and test ([cli.md › sauf dev](./cli.md#sauf-dev)); its environment test is the internal helper the output validation reads too ([`supports/runtime.ts` @ bc10401](https://github.com/Laratypes/Laratype/blob/bc10401/packages/http/src/supports/runtime.ts)).

### Invariants
- **The declared set:** the endpoint's resolved errors, as `apiRoutes()` gives them: the derived 422 (a query, body or headers schema), 404 (a path param), 401 (`auth`), 403 (`authorize`) and 429 (`throttle`), plus `throws` from the scope chain, the contract and the endpoint ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)). The check is a set lookup of `code` + `status`: a route's pairs are collected once and kept in a `WeakMap`, and production never builds them.
- **Declared:** a thrown error is declared when the code and status the client receives are in that set. The check reads a `ContractError`'s `code` and `status`, and a responsible 0.5 `Exception`'s `getHttpCode()` and the `code` of its `toJson()` body while its status is under 500 and its answer has a body: a guard throwing `UnauthorizedException` is the derived 401. The body's `code` is the one the filter sends (`resolveException` answers with `toJson()`), not `getErrorCode()`: a subclass whose body sends `TOKEN_EXPIRED` is checked as `TOKEN_EXPIRED` even when `getErrorCode()` says `UNAUTHORIZED`. A `code` JSON serialization would not write is no code: not an own enumerable key, not a string, or empty. `toJson()` is read synchronously, as the filter sends it: an async `toJson()` (the client gets `{}`) or a body with its own `toJSON` is not read, a known false negative. `toJson()` must be deterministic: the check reads the code and the filter calls it again for the answer. The body is not computed once and shared, because the filter also answers throws the check never sees (production returns before any read, a route without `Route.api` is skipped), so a shared body would need a per-request channel between the two kernels to cover only a `toJson()` that changes between calls. An error from another copy of either package counts, told by its `Symbol.for` brand.
- **Checked:** an error thrown by the handler or a middleware of a `Route.api` contract route, at any depth, and the rejection of its contract response resolution (a `JsonResource` whose `toJson()` throws): that resolution is `await`ed inside the same `try`. A route mounted through `RequestKernel.handle` alone has no resolved set (its contract and scope `throws` are unknown), so it is not checked.
- **Not checked:** an unknown error (a plain `Error`, a `TypeError`, a non-`Error` throw): it is the generic 500 already, and logged ([Exceptions](#exceptions)). A non-responsible `Exception` sends no code. A responsible 0.5 `Exception` with a 5xx status sends none either: every non-contract 5xx carries only `{ message: "Server Error" }` ([Exceptions](#exceptions)), so a `new UnauthorizedException({ httpCode: 503 })` is a server failure, not an undeclared `UNAUTHORIZED`. A 204, 205 or 304 answer carries no body at all, so no code: the check reads the filter's own rule, `isBodylessResponse`. A 5xx `ContractError` keeps its code and body, and is checked. A Hono `HTTPException` is a framework answer, not a contract error: the 413 of the default body limit, the malformed-body 400, the contract's own 422 and the throttle's 429. A 0.5 route (`Route.group`, an ad-hoc `r.get()`) has no endpoint to declare its errors against.
- **Dev:** `console.error`, the channel a 5xx is logged on, gets the line below and then the thrown error, whose stack is printed. The response is unchanged: the error's own status, code and body still go out, so a dev client sees `unexpected` ([client.md › Result union](./client.md#result-union) and [Exceptions](#exceptions)).
- **Test:** `NODE_ENV=test` fails the test instead: the check throws an `Error` whose message is the line and whose `cause` is the thrown error, so the exception filter answers the generic 500 with the line in its log, and the test fails on its own assertions. A test that covers the check alone asserts that 500 and log, or stubs `NODE_ENV=development` for the dev report. The thrown error itself is unchanged in dev and production; only test mode wraps it.
- **A check that fails:** reading the error is guarded: a `toJson()` that throws (or any other failure inside the check) is logged on its own line and the original error is kept, in dev and in test. Both diagnostic writes are guarded too: a `console.error` that throws, or an error whose `util.inspect` throws, never replaces the route's error. Only the test-mode wrapper above may replace the error.
- **Production:** the check returns before it reads or allocates anything (`__PROD__`, or `NODE_ENV=production` without it, the same test as the output validation's). `__PROD__` is read first, so an explicit `__PROD__ = false` wins over `NODE_ENV=production`. The response is the error's own, unchanged, and *this check* logs nothing: the exception filter's own logs (a non-contract 5xx, a reportable error) are unchanged and still happen ([Exceptions](#exceptions) › Logs). A dev build's set lookup never runs there.
- **One check, not two:** the handler's value against the response schema stays [Response from the contract](#response-from-the-contract) › Dev-mode output validation (H4 #107). This section only reads the thrown error.

### Diagnostics
- `[@laratype/http] <route>: the route threw <status> <CODE>, which the endpoint does not declare: add it with .throws(...) on the endpoint, or throws: [...] on its contract or a scope` (dev and test only; dev: logged with the error, response unchanged; test: logged, generic 500)
- `[@laratype/http] the undeclared-error check failed, the thrown error is unchanged:` then the failure that broke the check (dev and test only; the response is the original error's, never a check failure)

### Example
```ts
export default defineContract<Prefix>()({
  store: endpoint.post('/').body(NewUser).response(UserDto, 201).throws(EmailTaken),
})
// declare it, or the dev server reports 409 EMAIL_TAKEN and a test answers 500
throw EmailTaken(input.email)
```

Tests: [`packages/http/__tests__/response/undeclaredError.test.ts`](../../packages/http/__tests__/response/undeclaredError.test.ts) (each derived error, a `throws` of each level including one declared only by a scope, a middleware's error, dev, test, production, an unknown error, a non-contract 5xx `Exception`, a 5xx contract error, bodyless 204 / 205 / 304 answers, a subclass whose body code differs from `getErrorCode()`, a `JsonResource` whose `toJson()` throws, a check that throws, a throwing `console.error` and a throwing `util.inspect`, a 0.5 route) and [`bodyless.test.ts`](../../packages/http/__tests__/response/bodyless.test.ts) for the shared bodyless rule.

### Non-goals
- The `sauf test` coverage report, which lists declared errors that no test triggers: [#387](https://github.com/Laratypes/Laratype/issues/387).
- A warn-or-fail switch or a `--strict-contract` flag: the check is always on in dev and test.
- A second output check; it belongs to [Response from the contract](#response-from-the-contract).

### Open questions
- Resolved: undeclared errors are reported in dev and fail the test in tests, with no warn-or-fail switch ([#157](https://github.com/Laratypes/Laratype/issues/157)).

### Acceptance
[#157 Done when](https://github.com/Laratypes/Laratype/issues/157)
