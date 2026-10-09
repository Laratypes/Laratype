# S1 + S2 decisions: controller handler typing and FE API surface

Issues: #84 (S1), #85 (S2) · Tracking: #83 · Gates: H2 #105, C5 #93 · Feeds: H6 #117, H7 #118, CL1 #109, CL4 #140, C1 #89, C3 #91

Everything below is reproduced by one command (Node ≥ 22, `bun install` at the repo root, plus the `spikes/v1/node_modules` junction):

```
node spikes/v1/scripts/check-s1-s2.mjs        # 28 checks, prints the bundle table, exit 1 on any failure
```

Toolchain: TypeScript 5.9.2, Node 22.18.0, esbuild 0.25.9, @swc/core (S3 junction), zod 3.25.76 (which also provides `zod/v4` and `zod/v4-mini`).

| Path | What |
|---|---|
| `s1-controller/lib/ctx.ts` | `Ctx<E, Requires>`, `Result<E>`, `fail()`, `action()` (option B), `ControllerOf<C>` |
| `s1-controller/lib/router.ts` | Route builder (`middleware()`, `.bind()`, `contract()`) and the route-side check `VerifyController` |
| `s1-controller/app/**` | Fixture: `UserControllerA` (option A), `UserControllerB` (option B), `auth()`, `User`, `UserRepository`, routes |
| `s1-controller/tests/type-tests.ts` | `@ts-expect-error` type tests (part of `tsc -p spikes/v1`) |
| `s1-controller/tests/errors.fixture.ts` → `tsc-errors.txt` | Same failures without directives; the raw tsc output is committed |
| `s1-controller/runtime/di-interplay.ts` | Constructor DI × class fields at runtime under SWC (sauf `warmup.ts` options) and tsc |
| `s2-api/app/contracts/index.ts` | `defineApi({ users, posts })`: the only FE entry point |
| `s2-api/client/*` | (a) `create-client.ts`, (b) `path-client.ts`, (c) `manifest-client.ts`, shared `request.ts` / `types.ts` |
| `s2-api/scripts/gen.mjs` | Prototype `sauf types:generate`: TS checker only, writes the slim manifest and the flattened types |
| `s2-api/fe`, `fe-separate`, `fe-bad` | FE fixtures (`types: []`, DOM lib): monorepo, separate repo, and the `typeof routes` anti-pattern |
| `s2-api/bench/*` | The same contracts in `zod/v4` classic and `zod/v4-mini` (type-equal to the zod 3 ones) |
| `s2-api/scripts/bundle-sizes.mjs` | esbuild bundle + minify → gzip -9 / brotli 11 |

---

## S1 (#84): Decision

**Option A, class methods with an explicit `Ctx<>` annotation, is the v1 style.** The route-side check uses conditional types: the controller declares its requirements, and the route (middleware + `.bind()`) proves them at `r.contract()`. Option B (`action()`) is not shipped in v1. The route check already accepts any callable property, so B can be added later without changing H2.

```ts
export class UserController implements ControllerOf<typeof users> {   // optional: errors at the method
  constructor(private readonly repo: UserRepository) {}                // S3 constructor DI, no decorator
  async index({ query }: Ctx<typeof users.index>) { return this.repo.list(query.page); }
  async show({ params }: Ctx<typeof users.show, { params: { user: User } }>) { return params.user; }
  async destroy({ params, user }: Ctx<typeof users.destroy, { params: { user: User }; user: User }>) {
    if (user.role !== "admin") return fail(errors.forbidden, { message: "…" });
  }
}
r.middleware(auth()).bind({ user: User }).contract(users, UserController);
```

### Why A over B

| | A: method + `Ctx<>` | B: `x = action(e, handler)` |
|---|---|---|
| Handler without requirements | Annotation required (`noImplicitAny` forces it) | **Contextually typed, no annotation** |
| Handler with requirements (`user`, bound `params`) | Annotation | **Annotation still required.** There is no value to infer the requirements from, so B's main advantage disappears for most real handlers |
| Wrong return shape | At `r.contract()`, or **at the method** with `implements ControllerOf<typeof users>` | At the handler (on the arrow argument) |
| Handlers discoverable without an instance (route list, Detective, manifest, `sauf routes`) | Yes: on the prototype | **No**: own fields exist only after `new Ctrl(deps)`. Verified: `Object.getOwnPropertyNames(CtrlB.prototype)` has no `show` |
| Constructor DI + `useDefineForClassFields` | No interaction | Lazy closures work. A field initializer that reads an injected dep **eagerly** throws under SWC (sauf options) and tsc with useDefineForClassFields=true (`Cannot read properties of undefined (reading 'find')`). tsc catches it with TS2729 |
| Per-request cost | Methods are shared | One closure plus one `Object.assign` per handler per instance |
| Detached call (`const { show } = ctrl`) | Loses `this` (the runtime must call `instance[key](ctx)`) | Works (arrow) |
| Endpoint ↔ handler mapping at runtime | By key only | The `action` carries the endpoint, so the runtime can assert it |
| Familiarity (Laravel/Nest controllers, `sauf make:controller`) | Yes | New idiom |

### Route-side check design (for H2 #105)

- **Provided context per endpoint:** `Provided<E, X, B> = Ctx<E, X & { params: BoundParams<E, B> }>`, where `X` is the intersection of every middleware's `Ext` (accumulated by `.middleware()`, as in H6), and `B` is the `.bind()` map restricted to the endpoint's path params (as in H7). A class binder gives `InstanceType`. A resolver gives `NonNullable<Awaited<ReturnType>>`, because a miss is a 404.
- **Requirement check:** `[Provided] extends [Param]`, where `Param` is the handler's first parameter. This is one-directional. Function assignability is not usable: methods are compared bivariantly, so a naive `I extends { destroy(ctx: Provided): unknown }` **accepts** a handler that needs `user` on a route without `auth()` (asserted in `type-tests.ts`).
- **Return check:** `[Awaited<R>] extends [Result<E>]`, where `Result<E>` is the response schema **input** (the serializer runs afterwards), or `ErrorReply` for errors **declared on the endpoint** (`fail(errors.forbidden, …)` on an endpoint that only declares `notFound` is an error).
- **Also checked at `r.contract()`:** exhaustiveness (each endpoint needs a handler), `.bind()` keys that are not a path param of any endpoint, and a handler typed for a different endpoint (`Ctx` carries `endpoint: E`).
- **Readable errors:** `contract(c, ctrl: K & VerifyController<…>)` gives `unknown` when valid, otherwise an object type whose **property names are the diagnosis**. tsc always prints missing property names in full, while it truncates property *types* to `{ ...; }`. The values carry the details (`route_provides` / `handler_requires`).

### Type tests: real tsc output (`s1-controller/tsc-errors.txt`, TS 5.9.2)

(b) Missing middleware (`r.bind({ user: User }).contract(users, UserControllerA)`, no `auth()`):
```
errors.fixture.ts(15,40): error TS2345: Argument of type 'typeof UserControllerA' is not assignable to parameter of type 'typeof UserControllerA & { "users.destroy: handler requires `user`, route does not provide it (add middleware / .bind())": { handler_requires: User; }; }'.
```
(b) Missing binding (`r.middleware(auth()).contract(users, UserControllerB)`, no `.bind()`):
```
errors.fixture.ts(18,38): error TS2345: … Type 'typeof UserControllerB' is missing the following properties from type '{ "users.show: `params.user` provided by the route does not match the handler (missing .bind()?)": { route_provides: string; handler_requires: User; }; … }': "users.show: `params.user` provided by the route does not match the handler (missing .bind()?)", "users.destroy: `params.user` provided by the route does not match the handler (missing .bind()?)"
```
(a) Wrong return shape, option A, reported at `r.contract()`:
```
errors.fixture.ts(30,19): error TS2345: … Property '"users.show: return type does not match the response schema / declared errors"' is missing in type 'typeof WrongReturnA' …
```
(a) Wrong return shape, option B, reported at the handler (it names the path, not `users.show`):
```
errors.fixture.ts(35,51): error TS2322: Type 'Promise<{ id: string; name: string; }>' is not assignable to type 'MaybePromise<Result<Endpoint<"get", "/users/:user", …>>>'. … Property 'email' is missing in type '{ id: string; name: string; }' but required in type '{ id: number; name: string; email: string; }'.
```
Exhaustiveness and a bad bind key:
```
errors.fixture.ts(44,39): error TS2345: … missing the following properties …: "users.show: controller has no handler for this endpoint", "users.store: controller has no handler for this endpoint", "users.destroy: controller has no handler for this endpoint", ".bind(): `usr` is not a path param of any endpoint in users"
```
(c) is shown above: each message names the endpoint (`users.destroy`) and the missing or mismatched key (`user`, `params.user`).

The same cases are in `type-tests.ts` with `// @ts-expect-error`. `tsc -p spikes/v1` passes, and that proves each one fails where it should. That file also covers the positive cases, option B contextual typing, `implements ControllerOf` (error at the method), undeclared `fail()` errors, a wrong-endpoint `action`, the bivariance counter-example, and TS2729.

### Constructor DI interplay (run under 3 emitters: `out/s1/di-interplay.json`)

| | SWC (sauf `warmup.ts`) | tsc useDefineForClassFields=true | tsc useDefineForClassFields=false |
|---|---|---|---|
| A / B handler reaches the injected `repo` | ok / ok | ok / ok | ok / ok |
| Detached call A / B | throws (`this`) / ok | throws / ok | throws / ok |
| B field initializer reading `this.repo` eagerly | **throws** | **throws** | ok |
| Subclass with its own ctor dep + field override | ok | ok | ok |

SWC emits `repo;` as a class field, with `this.repo = repo` in the constructor, and keeps the other fields as native class fields. Those are initialized **before** the constructor body runs. With A, none of this matters.

### Open questions (H2 / H6 / H7)
1. **Per-endpoint middleware inside one contract** (for example `auth()` only on `destroy`). Options: `r.contract(users, Ctrl, { destroy: (r) => r.middleware(can("delete")) })`, or `.only()/.except()`. The check already works per endpoint, so only the builder shape is open. (H2/H6)
2. **Optional path params** (`:post?`) with `.bind()`: should the bound value be `Post | undefined`? (H7)
3. **`ctx.endpoint`**: keep it as a runtime field (useful for interceptors and logging), or make it phantom only? (H2)
4. **Type-perf** of `VerifyController` on large contracts (50+ endpoints) has not been measured; hand to S6 #95.
5. With A, the runtime must call `instance[key](ctx)`, never a detached reference. (H2/H11 interceptors)

---

## S2 (#85): Decision

**Monorepo FE:** the FE imports only `app/contracts/index.ts` (`defineApi({ users, posts })`), never `typeof routes`. The default runtime is **(a) `createClient(appApi)`**: no build step, and the same schemas are available for client-side form validation. The bundle cost is the schema lib, so docs and stubs should use `import * as z` (or `zod/v4-mini`). **(c)**, a generated slim manifest typed with `import type`, is the opt-in for FEs that do not want schemas in the bundle (about 0.7 KiB gzip in total). **(b)** path-style calls are an additive, type-only API (CL4).

**Separate-repo FE:** **(c)** via `sauf types:generate`. It writes one `api.ts`: a flattened `AppApi` type alias plus the slim manifest, with no contract lib and no zod. Use it with the manifest client (name-style) and/or the path client. Verified: `tsc --listFilesOnly` shows 2 own/generated files and 4 client files, nothing else.

### `tsc --listFilesOnly` (`types: []`, `lib: ["ES2022", "DOM"]`; `out/s2-listFilesOnly.json`)

| FE fixture | TS lib | contract lib | zod `.d.cts` | app contracts | client lib | own/generated | **server files** |
|---|---:|---:|---:|---:|---:|---:|---:|
| `fe` (monorepo, `@app/contracts` path alias) | 58 | 7 | 14 | 3 | 5 | 5 | **0** |
| `fe-separate` (generated `api.ts`) | 58 | 0 | 0 | 0 | 4 | 2 | **0** |
| `fe-bad` (`import type { r } from ".../routes"`) | 58 | 7 | 14 | 1 | 0 | 1 | **8** (routes, both controllers, model, repository, middleware, router + ctx lib) |

In a real app, the `fe-bad` row would also pull in hono, the ORM and `@types/node`, and with `types: []` it would fail to compile.

### Bundle size: FE entry using option (a), plus (b)/(c) for reference

esbuild 0.25.9, `bundle + minify`, ESM, browser, ES2022. Sizes are of the whole entry (client runtime + contracts + schema lib). Deterministic: 4 runs gave byte-identical results.

| Case | min | min+gzip | min+brotli | schema runtime in bundle |
|---|---:|---:|---:|---|
| (a) createClient(appApi), zod 3 `import * as z` | 58.43 KiB | **14.00 KiB** | 12.46 KiB | yes |
| (a) createClient(appApi), zod 3 `import { z }` | 60.99 KiB | 14.97 KiB | 13.32 KiB | yes |
| (a) createClient(appApi), zod/v4 classic `import * as z` | 56.40 KiB | 15.96 KiB | 14.19 KiB | yes |
| (a) createClient(appApi), zod/v4 classic `import { z }` | 239.69 KiB | **47.12 KiB** | 40.14 KiB | yes |
| (a) createClient(appApi), **zod/v4-mini** | 23.83 KiB | **8.27 KiB** | 7.47 KiB | yes |
| (b) path-style, type-only | 1.14 KiB | 0.63 KiB | 0.54 KiB | no |
| (c) slim manifest (monorepo) | 1.25 KiB | 0.68 KiB | 0.58 KiB | no |
| (c) separate repo (generated api.ts, manifest + path client) | 1.48 KiB | 0.76 KiB | 0.66 KiB | no |

Readings:
- zod 3 vs v4-mini for (a): **14.0 → 8.3 KiB gzip (−41%)**.
- `import { z } from "zod/v4"` makes `z` one namespace object that also carries the locales, so nothing tree-shakes: **3× larger** than `import * as z` (47.1 vs 16.0 KiB gzip). Stubs and docs must use `import * as z`.
- The client runtime itself is about 0.6 KiB gzip. Everything above that is schemas.

### Client option summary

| | (a) `createClient(appApi)` | (b) `api.get('/users/:user')` | (c) generated manifest |
|---|---|---|---|
| Runtime from contracts | Full contract values + schemas | none | method/path/error codes only |
| Call style | name (`api.users.show`) | path | name |
| Client-side validation with the same schemas | **yes** (`validateBody(appApi.users.store, form)`) | no | no |
| Build step | none | none | `sauf types:generate` (must be re-run or watched) |
| Monorepo types | inferred | `import type` + `ApiTypes<AppApi>` | `import type` + `ApiTypes<AppApi>` |
| Separate repo | no (needs the contracts and zod) | with generated types | **yes** |

### Findings for other issues
- **C1 adjustment (#89):** `Endpoint.response()` must return `Endpoint<…, NoInfer<C>, …>`. Without it, `defineContract("users", { index: endpoint.get(…).query(…).response(schema) })` infers `C = any` from the contextual return type (`AnyEndpoint = Endpoint<any, …>`) instead of the default `200`. This happens whenever `.response()` is the last call in the chain. It is fixed in `spikes/v1/contract/endpoint.ts`, with a regression assertion in `fe/src/type-tests.ts`. Already relayed to the C1 lane (packages/contract `endpoint.ts:74` has the same signature). No other builder changes are needed for S1/S2.
- **C3 (#91), docs:** zod 4 `z.coerce.number()` has **input** type `unknown`, so the client query type becomes `page?: unknown`. Use `z.coerce.number<number>()`. With that, the zod 4 and v4-mini contracts give client types identical to zod 3 (`bench/type-tests.ts`).
- **C5 (#93):** `ApiTypes<A>` / `EndpointTypes<E>` (`contract/api-types.ts`) is the schema-free projection. The FE client and the generator both consume it, and `sauf types:generate` prints exactly this shape.
- **CL1 (#109):** the client type constraint `ApiShape` has an index signature, so **generated types must be `type` aliases, not interfaces** (interfaces have no implicit index signature). Alternatively, relax the constraint to a mapped self-constraint.
- **CL2 (#110) / H4 (#107):** the client sees the response schema **output** typed as-is, but it arrives through JSON. A `Date` output would be typed `Date` and arrive as `string`. This needs a `Jsonify<>` (or wire-type) decision.
- **Codegen without runtime:** `gen.mjs` uses only the TS checker. Method and path are literal types, and the other fields print cleanly with `typeToString(NoTruncation)`. No contract module is executed, so there's no Node/ESM loader concern in `sauf types:generate`.

---

## Done when (#84)
- [x] Decision: **A** (method + `Ctx<>`), B deferred. Route check by conditional types, "controller declares, route proves".
- [x] Type tests: (a) wrong return shape errors (A at `r.contract()` or the method, B at the handler); (b) missing middleware / binding errors at `r.contract()`; (c) the message names the endpoint and the missing keys (real output in `s1-controller/tsc-errors.txt`).
- [x] Constructor DI interplay checked under SWC and tsc (both `useDefineForClassFields` settings).

## Done when (#85)
- [x] Decision: monorepo → (a) default, (c) opt-in, (b) additive; separate repo → (c) generated `api.ts`.
- [x] `tsc --listFilesOnly` proof (`types: []`, DOM): only contracts + contract lib + schema lib in the monorepo, and nothing but generated + client in the separate repo.
- [x] gzip table for (a) with zod 3 vs `zod/v4-mini` (+ v4 classic, + b/c).

---

## Draft comment for #84 (PM to review before posting)

> **S1 decision: Option A (class methods annotated with `Ctx<typeof users.show, { params: { user: User }; user: User }>`).** The route proves the requirements at `r.contract()` with a conditional-type check, `[Provided] extends [Param]`. Option B (`show = action(users.show, …)`) is deferred. It only removes the annotation for handlers with *no* requirements, its handlers are own fields (invisible without instantiating the controller with its DI deps), and an eager field initializer that reads an injected dep throws under SWC (`useDefineForClassFields`).
>
> Route check (for H2): `Provided = Ctx<E, MiddlewareExt & { params: Bound }>`. It checks requirements one-directionally (function assignability is bivariant for methods; there is a type test showing the naive check accepting a controller that needs `user` without `auth()`), the return type against response input | declared errors, exhaustiveness, and that `.bind()` keys are path params. The diagnosis is in the error type's property names, so tsc prints it untruncated:
> `… "users.destroy: handler requires \`user\`, route does not provide it (add middleware / .bind())": { handler_requires: User; }`
> `… "users.show: \`params.user\` provided by the route does not match the handler (missing .bind()?)": { route_provides: string; handler_requires: User; }`
> Wrong return shapes are reported at `r.contract()`, or at the method when the class `implements ControllerOf<typeof users>`.
>
> Details, raw tsc output and the DI runtime table: `spikes/v1/DECISIONS-S1-S2.md`, `spikes/v1/s1-controller/tsc-errors.txt`. Repro: `node spikes/v1/scripts/check-s1-s2.mjs`.
> Open for H2/H6/H7: per-endpoint middleware within one contract, optional-param binding, `ctx.endpoint` runtime vs phantom, type-perf at 50+ endpoints (S6).
>
> Carried to: H2 #105, H6 #117, H7 #118, S6 #95

## Draft comment for #85 (PM to review before posting)

> **S2 decision.** The FE imports only `app/contracts/index.ts` (`defineApi({ users, posts })`). With `types: []` + DOM, `tsc --listFilesOnly` loads 3 contract files, 7 contract-lib files and 14 zod `.d.cts`, and **0 server files**. The `typeof routes` fixture pulls in 8 server files.
> - **Monorepo FE:** (a) `createClient(appApi)` by default: no build step, and the same schemas are usable for form validation. Cost (whole FE entry, min+gzip): zod 3 **14.0 KiB**, zod/v4-mini **8.3 KiB**, zod/v4 classic 16.0 KiB. With `import { z } from "zod/v4"` it is **47.1 KiB**, because the namespace object defeats tree-shaking, so stubs and docs use `import * as z`. (c) The generated slim manifest is the opt-in for schema-free bundles (0.7 KiB). (b) Path-style calls stay a type-only addition (CL4, 0.6 KiB).
> - **Separate-repo FE:** (c) `sauf types:generate` writes one `api.ts` (a flattened `AppApi` type alias + the manifest). The FE program is then 2 generated/own files + 4 client files: no contract lib, no zod. The generator uses only the TS checker (it does not execute the contracts).
>
> Side findings: C1 `.response()` needs `NoInfer<C>` (otherwise status is `any` when `.response()` ends the chain); zod 4 `z.coerce.number()` input is `unknown`, so use `z.coerce.number<number>()`; generated API types must be type aliases (index-signature constraint); the client response type needs a JSON/wire-type decision (CL2/H4).
>
> Details and tables: `spikes/v1/DECISIONS-S1-S2.md`. Repro: `node spikes/v1/scripts/check-s1-s2.mjs`.
>
> Carried to: C5 #93, C3 #91, CL1 #109, CL2 #110, H4 #107, G1 #133, CL4 #140
