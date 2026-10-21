---
area: http
packages: ["@laratype/http"]
issues: [84, 104, 105, 106, 107, 108, 117, 118, 121, 122, 123, 138, 139, 157, 162, 163, 164, 184, 229]
verified-against: Laratype@d70daa7 (+ spike PR #197 @ 4c558fd)
last-verified: 2026-10-09
---

# HTTP (`@laratype/http`)

The v1 HTTP layer binds contracts to controllers on a Hono router. It runs a typed pipeline (middleware, binding, policies, validation, interceptors) and turns handler results and exceptions into the responses the contract declares.

**Router v2 ([#104](https://github.com/Laratypes/Laratype/issues/104)) and controller resolution (H2a [#105](https://github.com/Laratypes/Laratype/issues/105)) are the only v1 HTTP code so far.** The rest of `@laratype/http` on master is the 0.5 package. Its route tree is built by `_createNestedRoute` in `packages/http/src/routing/Route.ts`, controllers are resolved with `app.make()` in `Request.controllerKernel` (`packages/http/src/request/Request.ts`), and the status is guessed from the method name (`ControllerMethodHttpStatusCode`). Everything below is either **decided** (S1) or **planned**. Signatures quoted from the S1 spike (`spikes/v1/s1-controller/lib/*` on PR #197 @ 4c558fd) are the decided *shape* but are not package code. H2 [#105](https://github.com/Laratypes/Laratype/issues/105) owns the real signatures.

Decision record: S1 [#84](https://github.com/Laratypes/Laratype/issues/84), [DECISIONS-S1-S2.md §S1](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s1-84-decision).

| Section | Status |
|---|---|
| [Controller typing: Ctx and ControllerOf](#controller-typing-ctx-and-controllerof) | decided (S1 #84); `ctx.endpoint` merged (#105, H2a); the rest planned → #105, #106 |
| [Route proof at r.contract()](#route-proof-at-rcontract) | decided (S1 #84); `r.contract()` options merged at runtime (#105, H2a); route proof planned → #105 |
| [Router v2](#router-v2) | merged ([#104](https://github.com/Laratypes/Laratype/issues/104)); prod tree source merged ([#125](https://github.com/Laratypes/Laratype/issues/125)); registry storage planned → #114 |
| [Controller resolution](#controller-resolution) | merged ([#105](https://github.com/Laratypes/Laratype/issues/105), H2a); request scopes planned → #112 |
| [Request pipeline](#request-pipeline) | planned → #106, #138 |
| [Response from the contract](#response-from-the-contract) | planned → #107 |
| [Exceptions](#exceptions) | planned → #108 |
| [Typed middleware](#typed-middleware) | planned → #117 |
| [Model binding](#model-binding) | planned → #118, #163 |
| [Policies on routes: .can()](#policies-on-routes-can) | planned → #122; superseded by planned → #105, #121 |
| [Authorization from the contract](#authorization-from-the-contract) | `r.scope()` merged ([#104](https://github.com/Laratypes/Laratype/issues/104)); planned → #105, #121 |
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
Decided: S1 [#84](https://github.com/Laratypes/Laratype/issues/84) chose option A. `Ctx<E>` is merged with `endpoint` only (H2a [#105](https://github.com/Laratypes/Laratype/issues/105)). Its `params`, `query`, `body` and `Requires` are planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2b), [#106](https://github.com/Laratypes/Laratype/issues/106) (H3), and `ControllerOf` → [#105](https://github.com/Laratypes/Laratype/issues/105). The spike's `fail()`, `ErrorReply` and the error branch of `Result<E>` are removed: errors are thrown, and framework errors come from the contract's capabilities (planned → [#108](https://github.com/Laratypes/Laratype/issues/108)).

### Public API
Reference shape from the S1 spike ([`s1-controller/lib/ctx.ts` @ 4c558fd](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/s1-controller/lib/ctx.ts)). This is not package code, and H2 may refine the names of the helper types:

```ts
// abridged: spike reference, see the permalink; fail() and ErrorReply are removed (see Status)
type Ctx<E extends AnyEndpoint, Requires extends object = {}>;   // BaseCtx<E> merged with Requires (params merged one level deep)
// BaseCtx<E> = { readonly endpoint: E; params: PathParams<path>; query: InferOut<query>; body: InferOut<body> }
type Result<E extends AnyEndpoint>;        // response schema INPUT (void if none)
type ControllerOf<C>;                       // { [endpoint key]: (ctx: any) => MaybePromise<Result<C[K]>> }
```

Merged so far ([`packages/http/src/routing/api/types.ts`](../../packages/http/src/routing/api/types.ts)):

```ts
type Ctx<E extends AnyEndpoint> = { readonly endpoint: E };   // H2b adds Requires, H2b/H3 params, query and body
```

Until H3 [#106](https://github.com/Laratypes/Laratype/issues/106), the first argument of a `Route.api` handler is still the 0.5 request object, with `endpoint` added as a read-only property.

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
- `ctx.endpoint` is a read-only runtime field that holds the endpoint, so interceptors ([#138](https://github.com/Laratypes/Laratype/issues/138)) and X3 [#157](https://github.com/Laratypes/Laratype/issues/157) can read it (merged, [#105](https://github.com/Laratypes/Laratype/issues/105)). It is a non-writable, non-configurable, non-enumerable own property of the request's own object, so each request and each endpoint sees its own. 0.5 routes have no `endpoint`. A request class with its own `endpoint` field fails the request with `<route name>: the request already has an own "endpoint" property, which ctx.endpoint (#105) reserves: rename that field of <Request>`.
- **Return value:** a handler returns the response schema **input**, since the serializer runs afterwards.
- **Errors are thrown,** at any depth. A domain error is declared with `throws` ([contract.md › Domain errors](./contract.md#domain-errors)). Framework errors (401, 403, 404, 422, 429) come from the contract's capabilities and need no handler code.
- `implements ControllerOf<typeof c>` is optional. With it, a wrong return shape or a missing handler is reported at the method. Without it, the error appears at `r.contract()`.
- The runtime always calls `instance[key](ctx)`, never a detached reference (option A methods lose `this`). The instance comes from `app.make()` ([Controller resolution](#controller-resolution)).
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
Decided: S1 [#84](https://github.com/Laratypes/Laratype/issues/84). The `r.contract()` options are merged at runtime (H2a [#105](https://github.com/Laratypes/Laratype/issues/105)). The route proof is planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2b), [#117](https://github.com/Laratypes/Laratype/issues/117) (H6), [#118](https://github.com/Laratypes/Laratype/issues/118) (H7).

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
- **Options:** `r.contract(c, Ctrl, { policy, endpoints: {...} })`, merged at runtime (H2a [#105](https://github.com/Laratypes/Laratype/issues/105), see [Router v2](#router-v2)).
  - `policy` covers the endpoints with `authorize` ([Authorization from the contract](#authorization-from-the-contract)). It is recorded, not run: running it is planned → [#121](https://github.com/Laratypes/Laratype/issues/121), and the compile check that an `.authorize()` endpoint has one is planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2b).
  - `endpoints` holds per-endpoint middleware as callbacks keyed by endpoint name, for example `{ destroy: (r) => r.middleware(audit()) }`. Their extensions count for that endpoint only (typed middleware is planned → [#117](https://github.com/Laratypes/Laratype/issues/117)). Endpoint names can't collide with option keys.
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
merged ([#104](https://github.com/Laratypes/Laratype/issues/104)). The production tree source is merged ([#125](https://github.com/Laratypes/Laratype/issues/125)): `examples/basic` builds and serves its `Route.api` routes in production. The registry move into the container is planned → [#114](https://github.com/Laratypes/Laratype/issues/114). Controllers are resolved with `app.make()` ([Controller resolution](#controller-resolution), H2a [#105](https://github.com/Laratypes/Laratype/issues/105)) and run through the 0.5 `RequestKernel` pipeline until H3 [#106](https://github.com/Laratypes/Laratype/issues/106).

### Public API
[`packages/http/src/routing/api/ApiRouter.ts`](../../packages/http/src/routing/api/ApiRouter.ts) · [`packages/http/src/routing/api/types.ts`](../../packages/http/src/routing/api/types.ts)

```ts
class Route {
  static api<A extends object, const M extends readonly ApiRouteItem[]>(
    appApi: A, routes: (r: ApiRouteBuilder<A>) => M & CheckApiRoutes<A, M>): ApiRoutes;
}

interface ApiRouteBuilder<A> {
  middleware(...middleware: MiddlewareClass[]): ApiRouteBuilder<A>;                       // 0.5 Middleware classes
  contract<C extends ApiTreeContract<A> | ApiTreeNode<A>>(contract: C, controller: ControllerClass,
    options?: ContractRouteOptions<NoInfer<C>>): MountedContract<C>;                   // a contract or its tree node
  scope<D extends ApiScopeDir<A>>(dir: D, options: { readonly policy: PolicyClass }): MountedScope<D>;
}

interface ContractRouteOptions<C> {
  readonly policy?: PolicyClass;                 // recorded; running it is #121
  readonly endpoints?: { readonly [K in EndpointKey<C>]?: (r: EndpointRouteBuilder) => EndpointRouteBuilder };
}

interface EndpointRouteBuilder {
  middleware(...middleware: MiddlewareClass[]): EndpointRouteBuilder;
}

class ApiRoutes {                                // exported as a type: only Route.api() builds one
  readonly routes: readonly RouteEntry[];        // the registry entries, depth-first in tree order
  domain(domain: string): ApiRoutes;             // the same checked routes, served on that hostname only
  mount(app: Hono): RouteEntry[];                // registers every route on Hono (by specificity), returns the entries
}

interface RouteEntry extends ApiRoute {          // name, method, path, endpoint, contract, scopes + resolved capabilities
  readonly controller: readonly [ControllerClass, string];
  readonly middleware: readonly MiddlewareClass[];
  readonly policies: ReadonlyArray<{ readonly dir: string; readonly policy: PolicyClass }>;
  readonly policy: PolicyClass | undefined;      // the policy of r.contract(), if any
  readonly unenforced: readonly ("auth" | "authorize" | "throttle" | "validation")[];   // what the router does not enforce yet
  readonly domain: string | undefined;
}

type Ctx<E extends AnyEndpoint>;   // { readonly endpoint: E }, see Controller typing
type EndpointKey<C>;          // the endpoint keys of a contract or of its tree node
type ApiTreeName<A>;          // "users" | "users.posts"
type ApiTreeContract<A>;      // the contracts of the tree
type ApiTreeNode<A>;          // the tree nodes that hold a contract: typeof appApi.users | typeof appApi.users.posts
type ApiScopeDir<A>;          // "" | "users/[user]"
type ApiAuthorizeDir<A>;      // the scope folders with authorize
type CheckApiRoutes<A, M>;    // unknown, or { error: "Route.api: ..." }
const UNENFORCED_NOTICE: "auth, authorize, throttle and input schema validation are not enforced yet (planned → #105, #121, #229, #106)";
```

The tree comes from `$api` ([contract.md › Contract folder tree](./contract.md#contract-folder-tree)). In dev, the `laratype:api` Vite plugin of `sauf` ([`packages/sauf/src/typegen/plugin.ts`](../../packages/sauf/src/typegen/plugin.ts)) resolves `$api` and scans the tree the first time the app imports it.

### Invariants
- **Every contract exactly once.** The routes callback returns `r.contract()` and `r.scope()` items. A tree contract that is not mounted, or one mounted twice, is a compile error on the callback's return value and a runtime error in `Route.api`.
- **Contract or tree node.** `r.contract()` takes the contract or its tree node (`r.contract(appApi.users.posts, PostController)`). At compile time a contract is matched by its exact type and a tree node by its tree name; at runtime both are matched by value. Two contracts of the tree with identical types (`posts.ts` and `comments.ts` in one folder, both `{ index: endpoint.get('/').response(Dto) }`) can't be told apart by type, so mounting either by its contract is a compile error that asks for the tree node; mounted by their nodes, a missing or duplicate one is a compile error again.
- **Registration order.** Hono matches in registration order, so `mount()` registers the routes by specificity, not in tree order: comparing the path segments left to right, a static segment comes before a param constrained to one segment (`:id{[0-9]+}`), that one before a plain param (`:slug`), a plain param before a regex param that can match `/` (`:path{.+}`: an unescaped `.`, a `/`, a negated class `[^...]`, or `\S`, `\W`, `\D`), and that one before a wildcard (a stable sort, so equal routes keep their tree order). A parent's param route therefore never shadows a child's static one: with `users.ts` `{ show: '/:user' }` and `users/me.ts` `{ index: '/' }`, `GET /api/users/me` reaches `users.me.index`. With `files.ts` `{ show: '/:path{.+}' }` and `files/[id]/raw.ts`, `GET /api/files/42/raw` reaches the raw route; with `/:slug` and `/:id{[0-9]+}` at the same position, `GET /api/posts/42` reaches the id route and `/api/posts/abc` the slug one. `routes` and the returned entries keep the tree order.
  - Known limitation: the sort is per `Route.api`. Other `Route.api` groups and 0.5 `defineRouteGroup` routes register in the order the providers mount them, so a param route of one group can still shadow a static route of another: mount order matters across groups.
- **URLs from the tree.** A contract route's path is the full path from `apiRoutes()` (the folder tree plus the endpoint path), so contract routes take no prefix. Ad-hoc routes keep `Route.prefix(...)` and `group(...)` ([Ad-hoc routes](#ad-hoc-routes)), and the 0.5 `defineRouteGroup` routes keep working next to `Route.api`.
- **Handlers.** Each endpoint runs the controller method named after its key. Handlers must be class (prototype) methods of the controller or of a class between it and the base `Controller`: an arrow-function class field, `constructor`, an `Object.prototype` method or a base `Controller` method is not a handler, and is reported like a missing method. A controller without that method, or an `undefined` controller (usually a circular import), is a runtime error in `Route.api`. The compile check of the controller is H2 [#105](https://github.com/Laratypes/Laratype/issues/105) ([Route proof at r.contract()](#route-proof-at-rcontract)).
- **Scopes.** `r.scope('<folder>', { policy })` names a scope folder of the tree, written as in the entry `dirs` (root-relative, `""` for the root; [contract.md › defineApi and route names](./contract.md#defineapi-and-route-names)). A folder that is not a scope of the tree is an error at the argument and at runtime. A scope with `authorize` and no `r.scope()` is a compile error and a runtime error, and so is a scope mounted twice.
- **Status.** A contract route answers with its endpoint's status (`.response(schema[, status])` or `.status(n)`; 200 with a response schema, 204 with no body without one, and a 205 from `.status(205)` has no body either, see [Response from the contract](#response-from-the-contract)), passed to the 0.5 kernel as `RouteParams.status`, never one guessed from the method name. A `Response` the handler returns with its own status still wins. A 0.5 status decorator on the handler that disagrees with the endpoint's status is a runtime error in `Route.api`; an equal one is fine.
- **Path params are raw.** Contract routes skip the 0.5 implicit and `Route.model` binding (`RouteParams.modelBinding: false`), so a `[user]` folder never runs a lookup or answers an undeclared 404. The handler's second argument is the raw params object (`show(req, { user })` gets the string). Model binding for contracts is `r.bind`, H7 [#118](https://github.com/Laratypes/Laratype/issues/118).
- **Policies are recorded, not run.** A mounted scope policy is recorded on each route under its folder (`RouteEntry.policies`, outer to inner), and the `policy` of `r.contract()` on each route of the contract (`RouteEntry.policy`). Running them is planned → [#121](https://github.com/Laratypes/Laratype/issues/121): a scope policy's `before` needs the signed-in user ([#120](https://github.com/Laratypes/Laratype/issues/120)) and the bound models ([#118](https://github.com/Laratypes/Laratype/issues/118)).
- **Auth, rate limits and input validation are not enforced yet.** A route whose resolved `auth` or `authorize` is set still serves every request until [#105](https://github.com/Laratypes/Laratype/issues/105) and [#121](https://github.com/Laratypes/Laratype/issues/121). A resolved `throttle` sets no rate limit until H17 [#229](https://github.com/Laratypes/Laratype/issues/229). A route whose endpoint has a body, query or headers schema gets its input unchecked until H3 [#106](https://github.com/Laratypes/Laratype/issues/106). `RouteEntry.unenforced` records which of `auth`, `authorize`, `throttle` and `validation` apply. `mount()` logs one warning that lists those routes, once per process for each route list (the printed lists are remembered, up to 32, oldest dropped first, so an `--hmr` restart that mounts the same `Route.api` groups does not repeat it), and `sauf route:list` shows them in its "Not enforced" column (its "Policies" column lists the scope policies, then `contract: <Policy>`).
- **Middleware.** `r.middleware(...)` before `.scope()` applies to every contract under that folder; before `.contract()`, to that contract; in `r.contract(c, Ctrl, { endpoints: { <key>: (r) => r.middleware(...) } })`, to that endpoint only. A route's middleware is its scopes' (outer to inner), then its contract's, then its endpoint's, with duplicates removed: a middleware mounted at several levels (for example from one `r.middleware(Web)` builder used for a scope and a contract) runs once, at its first position. Typed middleware is H6 [#117](https://github.com/Laratypes/Laratype/issues/117).
- **Domain.** `.domain('api.example.com')` serves the routes on that hostname only. The hostname is made of non-empty labels of letters, digits and inner hyphens. `.domain()` re-labels the routes `Route.api` already checked. The match reads the `Host` header only (the request URL's host when there is none, as with an in-process `app.request()`), never `X-Forwarded-Host`: behind a proxy, the proxy must preserve the `Host` header. It ignores case, the request port (dev Host headers carry `:3000`) and one trailing dot (`api.example.com.`). A request for another host falls through to the next matching route, or gets a 404. `.domain()` is name-based virtual hosting, not an access-control boundary: any client can send any `Host` header, so no guard or policy may key on the domain alone.
- **Registry.** `mount()` returns one `RouteEntry` per route. `RouteAppServiceProvider` stores what `routes()` returns in `globalThis.__laratype_routes`, as in 0.5, and `sauf route:list` reads both v2 and 0.5 entries. The move to a container `RouteRegistry` is planned → [#114](https://github.com/Laratypes/Laratype/issues/114).
- **Tree source.** In dev, the `laratype:api` plugin runs G1's scan and emit (`syncContractTree`: `$types.d.ts` and `index.gen.ts`, with no TS checker and no `api.ts`) with config `api.root` / `api.base` from `app/config/config.ts`, then resolves `$api` to `.laratype/api/index.gen.ts`. The config is read outside the app's module graph: the project's `.env` is loaded first (`loadEnv`, as `EnvLoadServiceProvider` does), then the file is imported by an isolated jiti instance with no module cache, so the app's own later import evaluates it fresh with env loaded, and a config importing a module still loading up the app's import chain cannot deadlock the scan. That import evaluates the config's whole import graph, so the plugin runs it again only when the content of `app/config/config.ts` changed: a rescan for a contract added or deleted reuses the last value, and a failed read is not kept.
  - Known limitations of the config read: the isolated import knows no Vite or tsconfig `paths` alias, so `app/config/config.ts` and the modules it imports can't use aliases in dev; such an import fails with `[laratype:api] app/config/config.ts could not be imported on its own (no Vite or tsconfig path aliases there): <error>`. The cache is keyed on the text of `app/config/config.ts` only: after a change to `.env` or to a module the config imports, touch `config.ts` or restart `sauf dev` before `api.root` / `api.base` pick it up.
  - The first `$api` import scans the tree. Once the app has imported `$api`, `sauf dev --hmr` rescans before a restart only when the tree can have changed: a file added or deleted under the root, or the config file changed, added or deleted (see below). An edited config applies on that restart. An app that never imports `$api` is never scanned, so a 0.5 app with helpers in `app/api` still boots. Only files the scan reads count as tree files: no private `_x` / `$x` folders, non-`.ts` files or editor temp files. A failed scan is not cached.
  - Under `--hmr`, adding or deleting a file under the contract root (a contract or a `_scope.ts`) restarts the server like a change does, so `$api` follows. Restarts are coalesced: while one runs, any number of new events queue exactly one more. A failed restart releases what did boot (the providers' `down()` runs, and the Hono app and container are reset). Stopping an instance runs every cleanup even when one throws, then always resets the app (`Serve.stop()`), leaves no server, and requests get a 503 until the next change starts one. The tree is rescanned only when a file is added or deleted under the root, or the config file is changed, added or deleted. Until a scan has read the config, the root is the default `app/api`.
  - Files are written only when their content changes. When `index.gen.ts` changes, its module is invalidated (by its normalized module id). Writes under the plugin's output folder don't trigger an `--hmr` restart.
  - When the root folder doesn't exist, importing `$api` fails with `[laratype:api] the app imports $api, but the contract tree root "<root>" does not exist (set config api.root)`, and a stale `index.gen.ts` is never served: a restart that finds the root gone invalidates the index module and its importers, and loading the index fails with the same error. Scan and config errors are printed with the prefix `[laratype:api] `. `app/config/config.ts` must not import `$api`, directly or through other modules: `$api` is generated from the tree the config locates, and the isolated import cannot resolve it. That fails with `[laratype:api] app/config/config.ts must not import $api (directly or indirectly)`.
  - The router itself never scans: it takes the `appApi` value.
  - In production nothing scans (merged, [#125](https://github.com/Laratypes/Laratype/issues/125)). The build script is `sauf types:generate && tsc -b tsconfig.build.json && sauf build`. `tsconfig.build.json` has `"rootDir": "."` (so `dist` mirrors the project and `dist/.laratype/api/index.gen.js` finds `../../app/api/*`), `rootDirs: [".", ".laratype/types"]` (for `./$types`), `.laratype/api` in `include` (plus `database` with the v1 layout), and `paths: { "$api": ["./.laratype/api/index.gen.ts"] }`, which `sauf build` rewrites (`tsc-alias`) in the emitted files ([build.md › Plugin chain](./build.md#plugin-chain)).
  - Regenerating the files without a restart, and for the FE, is G2 [#142](https://github.com/Laratypes/Laratype/issues/142).
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
- `expected the appApi tree built with defineApi`
- `the routes callback must return r.contract() and r.scope() items`
- `.domain("<domain>") must be a hostname, such as "api.example.com"`
- `contract "<tree name>": r.contract() options must be { policy?, endpoints? }`
- `contract "<tree name>": { policy } must be a policy class`
- `contract "<tree name>": { endpoints } must map endpoint names to (r) => r.middleware(...)`
- `contract "<tree name>": endpoints.<key> is not an endpoint of the contract (endpoints: "<key>", ...)`
- `contract "<tree name>": endpoints.<key> must be a callback, (r) => r.middleware(...)`
- `<route name>: endpoints.<key> must return the builder it gets, (r) => r.middleware(...)`

Warning, logged once per `mount()` when some routes have a non-empty `unenforced`: `[@laratype/http] Route.api: auth, authorize, throttle and input schema validation are not enforced yet (planned → #105, #121, #229, #106), so these routes skip those checks: <route name> (auth[, authorize][, throttle][, validation]), ...`

### Example
[`examples/basic/app/routes/api.ts`](../../examples/basic/app/routes/api.ts) mounts [`app/api/posts.ts`](../../examples/basic/app/api/posts.ts), and its `RouteServiceProvider` registers it with `apiRoutes.mount(this.apps)`. With scopes:

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
- No controller check (the route proof): H2b [#105](https://github.com/Laratypes/Laratype/issues/105). No policy execution: [#121](https://github.com/Laratypes/Laratype/issues/121).
- No model binding (`r.bind()`): H7 [#118](https://github.com/Laratypes/Laratype/issues/118).
- No 401, 403 or 429 from the contract's capabilities: [#120](https://github.com/Laratypes/Laratype/issues/120), [#105](https://github.com/Laratypes/Laratype/issues/105), [#121](https://github.com/Laratypes/Laratype/issues/121), [#229](https://github.com/Laratypes/Laratype/issues/229).
- No domain params (`{account}.example.com`).

### Open questions
- None recorded.

### Acceptance
[#104 Done when](https://github.com/Laratypes/Laratype/issues/104)

---

## Controller resolution

### Status
merged ([#105](https://github.com/Laratypes/Laratype/issues/105), H2a). Request scopes are planned → [#112](https://github.com/Laratypes/Laratype/issues/112).

### Invariants
- **Resolution:** `Request.controllerKernel` resolves the controller with `app.make(Controller)` instead of `new`, for `Route.api` and 0.5 routes alike. That gives constructor DI through the [DI transform](./di.md#di-transform), and an app binding of the controller or of its dependencies applies.
- **Which container:** `RequestKernel.boot()` puts the app container on every request (`ContextApi.getContainer()`). Outside `RequestKernel` (a bare Hono app, as in tests), controllers are autowired without app bindings, by one container created on first use.
- **Lifetime:** an unbound controller is transient: a new instance per request, as with `new`. A binding's scope (`singleton`, `@Injectable({ scope })`) applies as it does anywhere else.
- **Errors:** a dependency the container cannot resolve is a `DiError` when the request runs, not when the routes mount. A controller (0.5 too) whose constructor takes params needs the [DI transform](./di.md#di-transform)'s metadata, so it must be app code the `laratype:di` plugin compiles; otherwise it fails where `new` used to pass `undefined`: ``Cannot autowire <Controller>: its constructor takes <n> param(s) but no dependency metadata was found. Fix: compile the controller with the laratype:di plugin (sauf dev / sauf build), or bind it with a factory in a service provider `register()` (an app binding, so it needs RequestKernel).`` `@Inject` can't fix it: without DI metadata the container fails before it reads `@Inject`.
- **Mount checks read the declared class:** the handler and status-decorator checks of `Route.api` read the class passed to `r.contract()`. A binding of that class should be a subclass of it.
- **Kernel container:** the kernel container passes `{ deps: depsRegistry }`, merged ([#102](https://github.com/Laratypes/Laratype/issues/102)).

### Design (non-binding)
- **Scope bubbling:** a controller that depends on a request-scoped provider becomes request-scoped ([#112](https://github.com/Laratypes/Laratype/issues/112)).

### Example
Tests: [`packages/http/__tests__/routing/controllerResolution.test.ts`](../../packages/http/__tests__/routing/controllerResolution.test.ts). In `examples/basic`, `GreetingService` is injected into `GreetingController` with no decorator.

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
- **Status:** taken from the contract ([contract.md › Endpoint builder](./contract.md#endpoint-builder)). The success status is `204` (no content) when there is no response schema and `200` when `.response(schema)` sets one. `.response(schema, status)` sets another status with a JSON body, `.status(status)` another one without a body (`202`), and both must be 2xx (`200`–`299`), in the types and when the endpoint is defined. A body needs a status other than 204 and 205 (Reset Content): `.response(schema, 204)` is an error (use `.status(204)`). `.response(schema)` without a status keeps one set by `.status(n)` before it (`.status(202).response(Dto)` is 202).
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
planned → [#108](https://github.com/Laratypes/Laratype/issues/108) (H5). Unknown errors are merged ([#267](https://github.com/Laratypes/Laratype/issues/267), H20): `Response.resolveException` answers any error that is not an `Exception` with a 500 and `{ message: "Server Error" }`, whatever the route's or controller's status, and logs the error on the server only (`console.error`). An `Exception` that is not responsible answers 500 too.

### Design (non-binding)
- **Domain errors:** a thrown `defineError` instance becomes its own status, code and body ([contract.md › Domain errors](./contract.md#domain-errors)).
- **Framework errors:** 401, 403, 404, 422 and 429 use the built-in catalog.
- **Wire format (decided by CL2 [#110](https://github.com/Laratypes/Laratype/issues/110)):** an error response's JSON body is the error's body plus its code, flat: `{ code, ...body }`. Domain errors and the framework catalog errors (401, 403, 404, 422, 429) use the same shape with their catalog code, for example `{ code: "VALIDATION_ERROR", message, errors }`. The client narrows by this `code` ([client.md › Result union](./client.md#result-union)).
- **Removed:** `fail()`, `ErrorReply` and the error branch of `Result<E>` ([Controller typing](#controller-typing-ctx-and-controllerof)).
- **Unknown errors:** a 500 with the body `{ message: "Server Error" }` (`MessageBody`), with no details and no `code`, so the client classifies it as unexpected ([#108](https://github.com/Laratypes/Laratype/issues/108)). A dev-mode detail view is out of scope for M1.
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
`r.scope()` is merged ([#104](https://github.com/Laratypes/Laratype/issues/104), H1): it mounts a scope policy, records it on the routes under the folder and checks that every scope with `authorize` has one ([Router v2](#router-v2)). `r.contract(c, Ctrl, { policy })` is merged and recorded on the routes (H2a [#105](https://github.com/Laratypes/Laratype/issues/105)). The compile check is planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2b); running policies, in the order below, is planned → [#121](https://github.com/Laratypes/Laratype/issues/121) (A3). Until then `authorize` is not enforced.

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
