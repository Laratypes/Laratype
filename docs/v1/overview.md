---
area: overview
packages: ["@laratype/contract", "@laratype/core", "@laratype/client", "@laratype/http", "@laratype/validation", "@laratype/database", "@laratype/auth", "sauf"]
issues: [83, 84, 85, 86, 87, 88]
verified-against: Laratype@d70daa7
last-verified: 2026-10-09
---

# Laratype v1: overview

The v1 redesign keeps Laravel's ergonomics (route files, FormRequest, Resources, Policies, facades, `sauf make:*`) and adds NestJS structure (a DI container, an explicit request pipeline) with types carried end to end. Tracking: [#83](https://github.com/Laratypes/Laratype/issues/83).

This file holds what every area shares: principles, the package graph, cross-cutting rules and the decision log. Each area's API is specified in its own file (table below). How to read a spec (Status values, section skeleton, examples) is in [README.md](./README.md).

## Areas

| Area | Spec | Packages | Issues |
|---|---|---|---|
| Contract | [contract.md](./contract.md) | `@laratype/contract` | C1–C6 (#89–#94) |
| DI | [di.md](./di.md) | `@laratype/core`, `sauf` (transform), `@laratype/support` (ServiceProvider) | D1–D8 (#96–#100, #112–#115), T1–T5 (#101–#103, #116, #158) |
| Client | [client.md](./client.md) | `@laratype/client` | CL1–CL6 (#109, #110, #124, #140, #141, #159) |
| Validation | [validation.md](./validation.md) | `@laratype/validation` | H3 (#106), H10 (#137) |
| HTTP | [http.md](./http.md) | `@laratype/http` | H1–H16 |
| Build | [build.md](./build.md) | `sauf` | B1–B16 |
| Auth | [auth.md](./auth.md) (skeleton) | `@laratype/auth` | A1–A4 (#119–#121, #151) |
| Typegen | [typegen.md](./typegen.md) (skeleton) | `sauf`, typegen | G1–G4 (#133, #142–#144) |
| Database | after S5 (#88) | `@laratype/database` | DB1–DB6 (#145–#150) |

## Principles

Status: decided ([#83](https://github.com/Laratypes/Laratype/issues/83) "Key decisions"; S1/S2 in [DECISIONS-S1-S2.md](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md) on #197; S3 in [FINDINGS.md](https://github.com/Laratypes/Laratype/blob/bddc5d8c56c18c2bced6594e87c5b757ba3709c3/spikes/v1/s3-di/FINDINGS.md) on #183).

1. **Contract first. Schemas are runtime values.** An endpoint is a runtime object that holds [Standard Schema](https://standardschema.dev) schemas (zod 3.25+, valibot, arktype). The same object drives runtime validation, handler types, the FE client, OpenAPI and Detective (G4 [#144](https://github.com/Laratypes/Laratype/issues/144)). Types are inferred from schemas, never from decorators.
2. **Decorators are for DI and the ORM only, never for API types.** TS decorators cannot change types. Routes, validation and responses are declared in contracts. Decorators are used for `@Inject(token)`, for `@Injectable({ scope })` when the default scope is wrong, and for ORM entities.
3. **Constructor DI without mandatory decorators.** A build transform (oxc, before SWC) emits dependency thunks for every class with an own constructor. Concrete classes autowire, while interfaces and primitives need a token.
4. **The FE never imports server code.** The FE imports only `app/contracts/index.ts` (`defineApi(...)`), never `typeof routes` (S2). `@laratype/contract` and `@laratype/client` are browser-safe.
5. **The controller declares, the route proves.** Handlers are class methods annotated with `Ctx<typeof endpoint, Requires>`. The route (middleware + `.bind()`) proves those requirements at `r.contract()` with a conditional-type check (S1, option A).
6. **One build pipeline.** `sauf dev`, `sauf build` and tests share one plugin chain: manifest → di → swc → alias.
7. **Clean break.** v1 is a redesign with breaking changes. Migration from 0.5 is tracked in K3 [#154](https://github.com/Laratypes/Laratype/issues/154).

## Package graph

Status column: `merged @ <sha>` | `proposed: PR #N @ <head sha>` | `planned → #N`. "0.5" means 0.5.x code that v1 will replace or port.

| Package | Role in v1 | Status | Depends on (v1) |
|---|---|---|---|
| `@laratype/contract` | `endpoint`, path params, error catalog, Standard Schema types | merged @ d70daa7 (C1/C2/C4); C3 proposed: PR #205 @ 8791758; C5 proposed: PR #204 @ ded1bfc | none (browser-safe, no `node:*`) |
| `@laratype/core` | DI container, tokens, deps registry | scaffold merged @ d70daa7; D1 proposed: PR #196 @ 5d51b16; D2 proposed: PR #201 @ 1bddcff | none |
| `@laratype/client` | `createClient(appApi)` | scaffold merged @ d70daa7 (`PACKAGE_NAME` only); API planned → #109 | `@laratype/contract` only |
| `@laratype/support` | `ServiceProvider` lifecycle (and 0.5 helpers) | 0.5; ServiceProvider v2 proposed: PR #202 @ 18c01f5 | `@laratype/core` |
| `sauf` | CLI, dev server, the `laratype:di` transform | 0.5; transform core proposed: PR #194 @ 5460e6d; Vite wiring planned → #102 | `@laratype/core` (runtime helper) |
| `@laratype/http` | Router v2, pipeline, controllers, `Ctx` | 0.5; v1 planned → #104, #105, #106 | contract, core |
| `@laratype/validation` | FormRequest v2 on Standard Schema | 0.5; v1 planned → #137 | contract |
| `@laratype/auth` | Guards, typed `Register`, policies | 0.5; v1 planned → #119, #120, #121 | core, http |
| `@laratype/database` | Eloquent-like Model | 0.5 (TypeORM); v1 waits for S5 → #88 | core |
| typegen (replaces `@laratype/ts-gen`) | `sauf types:generate` (`api.ts`, OpenAPI) | planned → #133, #143 | contract |
| `laratype` | Kernel / `Serve` | 0.5; container boot proposed: PR #202 @ 18c01f5 | core, support |

Other 0.5 packages (`console`, `log`, `mail`, `i18n`, `schedule`, `broadcast`, `storage`) are ported or built in M3/M4. See the issues listed on #83.

### Invariants
- `@laratype/contract` compiles with `lib: [ES2022, DOM]` and `types: []`. This is enforced by `packages/contract/__tests__/typecheck.test.ts` ("src is browser-safe").
- `@laratype/client` imports only `@laratype/contract`. The FE bundle budget is under 5 kB gzip for the runtime of `@laratype/client` + `@laratype/contract`, excluding the user-chosen schema library (B8 [#132](https://github.com/Laratypes/Laratype/issues/132)).
- `@laratype/core` has no dependency on HTTP. The Hono app enters the container as a binding (`HTTP_APP`, see [di.md](./di.md#serviceprovider-v2-and-kernel-boot)).

## Cross-cutting rules

| Rule | Why | Status / source |
|---|---|---|
| App code uses `import type` for type-only imports (`verbatimModuleSyntax: true`) | An interface imported as a value breaks DI differently in each environment: a Node ESM link error, a `vite build` "is not exported" error, or a `sauf dev` resolve-time `DiError`. Only TS1484 catches it consistently. | S3 condition 1 ([#86](https://github.com/Laratypes/Laratype/issues/86)). Not enabled repo-wide yet. Migration B11 [#185](https://github.com/Laratypes/Laratype/issues/185): proposed: PR #203 @ 16080c9. |
| Keep SWC `decoratorMetadata: true` | TypeORM's bare `@Column()` needs `design:type`, and throws `ColumnTypeUndefinedError` without it | S3 condition 2. Revisit if S5 ([#88](https://github.com/Laratypes/Laratype/issues/88)) drops TypeORM |
| Consumers need TypeScript ≥ 5.4 | `Endpoint.response()` uses `NoInfer` in emitted `.d.ts` files | `@laratype/contract` peer dep `typescript >=5.4` (optional) |
| Docs and stubs write `import * as z from "zod"` | With zod 4, `import { z }` defeats tree-shaking (47.1 vs 16.0 KiB gzip FE entry) | S2 ([#85](https://github.com/Laratypes/Laratype/issues/85)) |
| Zod 4 coerce in contracts: `z.coerce.number<number>()` | Plain `z.coerce.number()` has input type `unknown`, so client query types become `unknown` | S2 finding for C3 |
| The FE type is `AppApi = typeof appApi` (from `defineApi`). `AppRouter` is retired. | `typeof routes` pulls server files into the FE program (8 in the S2 fixture) | S2; fixture `fe/bad.ts` on PR #204 |

## Decision log

| # | Decision | Outcome | Record |
|---|---|---|---|
| S1 | Controller handler typing | **Option A:** class methods with an explicit `Ctx<E, Requires>` annotation; `implements ControllerOf<typeof c>` is optional. The route proves requirements at `r.contract()` using `[Provided] extends [Param]`. Option B (`action()`) is deferred. | [#84](https://github.com/Laratypes/Laratype/issues/84), [DECISIONS-S1-S2.md §S1](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s1-84-decision). Code: planned → [#105](https://github.com/Laratypes/Laratype/issues/105) (H2) |
| S2 | FE API surface and client runtime | **FE imports contracts only** (`defineApi`). **Monorepo:** (a) `createClient(appApi)` by default; (c) a generated slim manifest as an opt-in. **Separate repo:** (c) `sauf types:generate` writes `api.ts` (`AppApi` + manifest). The named call style `api.users.show()` is primary; the path style is type-only (CL4). | [#85](https://github.com/Laratypes/Laratype/issues/85), [DECISIONS-S1-S2.md §S2](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s2-85-decision) |
| S3 | Constructor DI metadata transform | **GO**, with 3 conditions: `verbatimModuleSyntax`, keep `decoratorMetadata`, keep runtime diagnostics. Output: `__laratype_deps(Cls, [slots], { params, optional })`. Cost: about 0.3 ms warm for 43 files. | [#86](https://github.com/Laratypes/Laratype/issues/86) (closed), [FINDINGS.md](https://github.com/Laratypes/Laratype/blob/bddc5d8c56c18c2bced6594e87c5b757ba3709c3/spikes/v1/s3-di/FINDINGS.md) |
| S4 | Package scaffold | `contract`, `core` and `client` exist and build (ESM/CJS + d.ts). The zod catalog is `^3.25`. | [#87](https://github.com/Laratypes/Laratype/issues/87) (closed), merged in 037b6d5 |
| S5 | ORM for v1 (Kysely vs keep TypeORM) | **Open.** Blocks H7 (#118), H14 (#163) and DB1–DB6. Also defines the minimal `BindableModel` interface. | [#88](https://github.com/Laratypes/Laratype/issues/88) |

Later rulings (recorded here because they settle conflicting wording in older sources):

- **`ControllerOf<C>`** is the name of the optional controller interface. `Implement<>` is stale.
- **Scopes:** `singleton`, `request` and `transient`. "scoped" is an old word for `request`.
- **DI transform output:** the T1 shape `__laratype_deps(Cls, [thunk | { unresolved, index }], { params, optional })` is canonical. See [di.md](./di.md#di-transform).

## Non-goals (v1)
- Decorator-based route, validation or response declarations (Nest-style `@Get()` / `@Body()`).
- Inferring FE types from server route files.
- Edge platforms beyond node, bun and vercel before M4 (X2 [#156](https://github.com/Laratypes/Laratype/issues/156)).
