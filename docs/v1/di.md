---
area: di
packages: ["@laratype/core", "sauf", "@laratype/support", "laratype"]
issues: [96, 97, 98, 99, 100, 101, 102, 103, 112, 113, 114, 115, 116, 153, 158]
verified-against: Laratype@d70daa7 (+ PR #196 @ 5d51b16, PR #201 @ 1bddcff, PR #202 @ 18c01f5, PR #194 @ 5460e6d, PR #199 @ 8a8e9c7)
last-verified: 2026-10-09
---

# Dependency injection

Constructor injection works without mandatory decorators. A build transform (oxc, before SWC) records each constructor's dependencies as lazy thunks. A container resolves them: concrete classes autowire, and interfaces or primitives go through a typed token. Service providers bind things into the container in two phases (`register()` → `boot()`).

On master `@laratype/core` is still the S4 scaffold (`PACKAGE_NAME` only, merged @ d70daa7). Everything else below is in open PRs, stacked like this:

```
PR #196 D1 container ─┬─ PR #201 D2 deps registry
                      └─ PR #202 D4 ServiceProvider v2 + kernel boot
PR #194 T1 transform ─── PR #199 T3 snapshot + runtime tests
```

Canonical API: the exports of `packages/core/src/index.ts`, `packages/sauf/src/di/index.ts` and `packages/support/src/ServiceProvider.ts` at the SHAs below. Executable spec: `packages/core/__tests__/`, `packages/sauf/__tests__/di/` and `packages/support/__tests__/ServiceProvider.test.ts`.

| Section | Status |
|---|---|
| [Tokens](#tokens) | proposed: PR #196 @ 5d51b16 |
| [Container](#container) | proposed: PR #196 @ 5d51b16 |
| [Dependency metadata](#dependency-metadata) | proposed: PR #196 @ 5d51b16 |
| [Deps registry](#deps-registry) | proposed: PR #201 @ 1bddcff |
| [DI transform](#di-transform) | proposed: PR #194 @ 5460e6d; tests proposed: PR #199 @ 8a8e9c7 |
| [ServiceProvider v2 and kernel boot](#serviceprovider-v2-and-kernel-boot) | proposed: PR #202 @ 18c01f5 |
| [Decorators: @Inject and @Injectable](#decorators-inject-and-injectable) | planned → #98 |
| [Vite plugin `laratype:di`](#vite-plugin-laratypedi) | planned → #102 |
| [Resolution errors with fix hints](#resolution-errors-with-fix-hints) | planned → #100 |
| [Request scope and scope bubbling](#request-scope-and-scope-bubbling) | planned → #112 |
| [Boot-time graph diagnostics](#boot-time-graph-diagnostics) | planned → #113 |
| [Container-backed registries and facades](#container-backed-registries-and-facades) | planned → #114, #115 |
| [Bun build plugin](#bun-build-plugin) | planned → #116 |
| [Method injection](#method-injection) | planned → #158 |
| [Modules](#modules) | planned → #153 |

Area rules (S3 [#86](https://github.com/Laratypes/Laratype/issues/86), [FINDINGS.md](https://github.com/Laratypes/Laratype/blob/bddc5d8c56c18c2bced6594e87c5b757ba3709c3/spikes/v1/s3-di/FINDINGS.md)):
- App code must use `import type` for type-only imports (`verbatimModuleSyntax`). An interface imported as a value fails in different ways: a Node ESM link error, `vite build` "is not exported", or a resolve-time `DiError` in `sauf dev`. The repo-wide migration (B11 [#185](https://github.com/Laratypes/Laratype/issues/185)) is proposed: PR #203 @ 16080c9.
- SWC `decoratorMetadata` stays `true` while TypeORM is in use (S5 [#88](https://github.com/Laratypes/Laratype/issues/88)).
- Runtime diagnostics are kept, because in `sauf dev` they are the only signal.

---

## Tokens

### Status
proposed: PR #196 @ 5d51b16 (D1 [#96](https://github.com/Laratypes/Laratype/issues/96)).

### Public API
[`token.ts` @ 5d51b16](https://github.com/Laratypes/Laratype/blob/5d51b16f6dbec82d14b4940ad21bd95c9982b87f/packages/core/src/token.ts#L1-L18)

```ts
export class InjectionToken<T = unknown> {
  declare readonly __type: T;          // phantom
  constructor(readonly name: string);
  toString(): string;                  // "InjectionToken(<name>)"
}
export function token<T>(name: string): InjectionToken<T>;
```

### Invariants
- A token is a typed key for values that have no runtime class (interfaces, primitives, config objects). `container.make(TOKEN)` returns `T`.
- Identity is by object, not by name. Two `token('x')` calls give two distinct keys.

### Diagnostics
- Type-only (`container.types.test.ts`): tokens are typed apart (`const n: string = c.make(PORT)` fails when `PORT` is `InjectionToken<number>`).

### Example
[`examples/di/proposed/container.ts`](./examples/di/proposed/container.ts) (checked against PR #201 @ 1bddcff, which includes D1).

### Non-goals
- No string or symbol keys. Use a token.

### Open questions
- None recorded.

### Acceptance
[#96 Done when](https://github.com/Laratypes/Laratype/issues/96)

---

## Container

### Status
proposed: PR #196 @ 5d51b16 (D1 [#96](https://github.com/Laratypes/Laratype/issues/96)).

### Public API
[`container.ts` @ 5d51b16](https://github.com/Laratypes/Laratype/blob/5d51b16f6dbec82d14b4940ad21bd95c9982b87f/packages/core/src/container.ts#L1-L180)

```ts
export type Newable<T = unknown> = new (...args: any[]) => T;
export type AbstractNewable<T = unknown> = abstract new (...args: any[]) => T;
export type Token<T = unknown> = AbstractNewable<T> | InjectionToken<T>;
export type Factory<T> = (container: Container) => T;
export type Concrete<T> = Newable<T> | Factory<T>;      // no `prototype` (arrow fn) = factory; otherwise a class to autowire
export type Scope = 'transient' | 'singleton';
export interface BindOptions { scope?: Scope }
export interface ContainerOptions { deps?: DepsLookup }  // children inherit the parent's lookup
export class DiError extends Error { name: 'DiError' }

export class Container {
  constructor(options?: ContainerOptions, parent?: Container);
  bind<T>(token: Newable<T>, concrete?: undefined, options?: BindOptions): this;
  bind<T>(token: Token<T>, concrete: NoInfer<Concrete<T>>, options?: BindOptions): this;
  singleton<T>(token: Newable<T>): this;
  singleton<T>(token: Token<T>, concrete: NoInfer<Concrete<T>>): this;
  transient<T>(token: Newable<T>): this;
  transient<T>(token: Token<T>, concrete: NoInfer<Concrete<T>>): this;
  instance<T>(token: Token<T>, value: NoInfer<T>): this;
  has(token: Token): boolean;
  make<T>(token: Token<T>): T;
  createChild(options?: ContainerOptions): Container;
}
```

### Invariants
- **Scopes in D1:** `transient` and `singleton`. `bind()` is transient unless `{ scope: 'singleton' }` is passed. `request` scope is planned → [#112](https://github.com/Laratypes/Laratype/issues/112). Final scope names: `singleton | request | transient`.
- **Autowire:** `make(Cls)` with no binding builds the class from the deps lookup, so unregistered concrete classes need no registration. Autowired classes are **transient** for now, Laravel-style. Whether the default becomes singleton is decided in [#112](https://github.com/Laratypes/Laratype/issues/112).
- **Resolution order:** look up the binding through the parent chain. If none is found and the key is a class, autowire it. Otherwise throw.
- **Singletons** are built by the container that **owns** the binding, so a child's overrides never leak into a shared instance. The first result is cached. Rebinding replaces both the binding and its cached instance.
- **Children** (`createChild`) see the parent's bindings, and their own bindings shadow them without touching the parent. Transient parent bindings and autowired classes resolve with the child's overrides.
- **Self-binding:** `bind(Cls)` / `singleton(Cls)` without a concrete binds the class to itself. Tokens and abstract classes cannot self-bind (type error, plus a runtime `DiError` for tokens).
- **`has()`** counts explicit bindings only (searching up the chain). Autowirable classes don't count. This may change: [#112](https://github.com/Laratypes/Laratype/issues/112).
- **Cycles:** the keys being resolved are tracked across the whole container tree, factories included. A cycle throws, and the container recovers for later resolutions.
- **Constructor params** come from the `DepsLookup` (see [Dependency metadata](#dependency-metadata)). A slot listed in `meta.optional` resolves to `undefined` when it is unresolved, or when its thunk returns `undefined`, so a JS default applies. Without metadata, only zero-arg classes can be built.
- `optional` only covers an unresolved slot or a thunk returning `undefined`. If the thunk returns a key that fails to resolve (for example an unbound token), `make()` still throws.
- Abstract classes are guarded at the type level only. A runtime guard is an open question in [#112](https://github.com/Laratypes/Laratype/issues/112).

### Diagnostics
`DiError` messages (exact text; `<C>` is the class name or `<anonymous class>`, tokens print as `InjectionToken(<name>)`):
- `No binding for <key>.`
- `Cannot bind <key> to itself: only a class can be self-bound.`
- `Cannot autowire <C>: its constructor takes <n> param(s) but no dependency metadata was found.`
- `Cannot resolve <C> constructor param #<i> \`<name>\`: type \`<TypeText>\` has no runtime value.`
- `Cannot resolve <C> constructor param #<i> \`<name>\`: its type resolved to undefined at runtime.`
- `Circular dependency: A -> B -> A`

The `` `<name>` `` part appears only when `meta.params` has a name. Fix hints are planned → [#100](https://github.com/Laratypes/Laratype/issues/100).

Type-only (`container.types.test.ts`): binding an unrelated class, a factory with the wrong return type, `instance()` with the wrong value type, self-binding an abstract class or a token.

### Example
[`examples/di/proposed/container.ts`](./examples/di/proposed/container.ts)

### Non-goals
- No decorators in D1 (see [#98](https://github.com/Laratypes/Laratype/issues/98)).
- No async factories or async resolution.
- No eager boot-time validation (see [#113](https://github.com/Laratypes/Laratype/issues/113)).

### Open questions
- Default scope for autowired classes, whether `has()` should count autowirable classes, and a runtime abstract-class guard → [#112](https://github.com/Laratypes/Laratype/issues/112) ("Carried from D1").
- **Interim behaviour:**
  - The transient default for `bind()` and autowired classes is interim until [#112](https://github.com/Laratypes/Laratype/issues/112) decides.
  - The container does not yet detect `@Inject`-vs-thunk conflicts (S3 condition 3). That arrives with the runtime decorator records ([#98](https://github.com/Laratypes/Laratype/issues/98)) and the fix-hint messages ([#100](https://github.com/Laratypes/Laratype/issues/100)).

### Acceptance
[#96 Done when](https://github.com/Laratypes/Laratype/issues/96)

---

## Dependency metadata

### Status
proposed: PR #196 @ 5d51b16 (D1 [#96](https://github.com/Laratypes/Laratype/issues/96)).

### Public API
[`deps.ts` @ 5d51b16](https://github.com/Laratypes/Laratype/blob/5d51b16f6dbec82d14b4940ad21bd95c9982b87f/packages/core/src/deps.ts#L1-L36)

```ts
export interface UnresolvedSlot { unresolved: string; index: number }
export type DepSlot = (() => unknown) | UnresolvedSlot;   // lazy thunk to the key, or a marker for a type with no runtime value
export interface DepsMeta { params: string[]; optional?: number[] }
export interface DepsEntry { slots: DepSlot[]; meta?: DepsMeta }
export interface DepsLookup { get(cls: Function): DepsEntry | undefined }   // a Map/WeakMap satisfies it
export const noDeps: DepsLookup;                          // default: no metadata
```

### Invariants
- There is one slot per constructor param and slots are never skipped, so `slots[i]` is param `i`. A trailing rest param gets no slot.
- Thunks are evaluated only at resolve time. That is why circular module imports work without `forwardRef`.
- `DepsLookup.get(cls)` returns the entry that applies to `cls`: its own entry, or the one inherited when `cls` has no own constructor.
- `new Container()` without `deps` uses `noDeps`. Production code passes `{ deps: depsRegistry }` (see [Deps registry](#deps-registry)).

### Diagnostics
See [Container](#container): unresolved slots and thunks that return `undefined`.

### Example
[`examples/di/proposed/container.ts`](./examples/di/proposed/container.ts)

### Non-goals
- No metadata for methods (see [#158](https://github.com/Laratypes/Laratype/issues/158)).

### Open questions
- None recorded.

### Acceptance
[#96 Done when](https://github.com/Laratypes/Laratype/issues/96)

---

## Deps registry

### Status
proposed: PR #201 @ 1bddcff (D2 [#97](https://github.com/Laratypes/Laratype/issues/97); stacked on PR #196).

### Public API
[`registry.ts` @ 1bddcff](https://github.com/Laratypes/Laratype/blob/1bddcffd0e0e67e494baad59e58d75a65b4bc55c/packages/core/src/registry.ts#L1-L64)

```ts
export function __laratype_deps<T extends Function>(cls: T, slots: DepSlot[], meta?: DepsMeta): T;  // returns cls unchanged
export function hasOwnDeps(cls: Function): boolean;
export function getDeps(cls: Function): { owner: Function; entry: DepsEntry } | undefined;
export const depsRegistry: DepsLookup;     // new Container({ deps: depsRegistry })
```

### Invariants
- `__laratype_deps` is the call the [DI transform](#di-transform) emits. It stores the entry as an **own, non-enumerable, configurable** property under `Symbol.for('laratype.di.deps')`:
  - `configurable`, so an HMR re-run can register the class again;
  - `Symbol.for`, so two copies of `@laratype/core` in one bundle agree on the key.
- `getDeps` walks from `cls` up the prototype chain. At each class it uses, in order:
  1. its own registered entry;
  2. otherwise its own `design:paramtypes`, for third-party decorated classes, only when `reflect-metadata` is loaded;
  3. otherwise it moves to the parent.

  So a class with its own constructor uses only its own params, and a class without one inherits the nearest ancestor's.
- In the `design:paramtypes` fallback, `undefined`, `Object`, `String`, `Number`, `Boolean`, `Symbol`, `BigInt`, `Function`, `Array` and `Promise` become `{ unresolved }` slots (interfaces erase to `Object`). That entry has `meta.params = []`.
- `virtual:laratype/di` (the transform's helper import) maps to `@laratype/core` through the Vite plugin, planned → [#102](https://github.com/Laratypes/Laratype/issues/102).
- `reflect-metadata` is a devDependency of `@laratype/core` (tests only). The package never imports it.

### Diagnostics
None of its own. Resolution errors come from the [Container](#container).

### Example
[`examples/di/proposed/container.ts`](./examples/di/proposed/container.ts) calls `__laratype_deps` by hand to show what the transform emits.

### Non-goals
- No `@Inject` override records (see [#98](https://github.com/Laratypes/Laratype/issues/98)).

### Open questions
- None recorded.

### Acceptance
[#97 Done when](https://github.com/Laratypes/Laratype/issues/97)

---

## DI transform

### Status
proposed: PR #194 @ 5460e6d (T1 [#101](https://github.com/Laratypes/Laratype/issues/101)). Snapshot and runtime tests proposed: PR #199 @ 8a8e9c7 (T3 [#103](https://github.com/Laratypes/Laratype/issues/103); stacked on PR #194). Not wired into `sauf dev/build` yet (planned → [#102](https://github.com/Laratypes/Laratype/issues/102), [#116](https://github.com/Laratypes/Laratype/issues/116)).

### Public API
[`transform.ts` @ 5460e6d](https://github.com/Laratypes/Laratype/blob/5460e6d5a6bda0c7f81162f9b5b093c595535754/packages/sauf/src/di/transform.ts#L1-L95)

```ts
export const DI_HELPER = '__laratype_deps';
export const DI_VIRTUAL_ID = 'virtual:laratype/di';
export const DI_DEFAULT_CLASS_NAME = '__laratype_default';
export interface DiTransformOptions {
  helperId?: string;        // module the helper is imported from; default 'virtual:laratype/di'
  injectNames?: string[];   // extra local names of the @Inject decorator
}
export interface DiTransformResult { code: string; map: SourceMap }   // magic-string SourceMap
export function transformDi(code: string, id: string, options?: DiTransformOptions): DiTransformResult | null;
```

Emitted shape (canonical):

```ts
import { __laratype_deps } from "virtual:laratype/di";
export class Notifier {
  constructor(@Inject(MAILER) private mailer: Mailer, public name: string, public clock: Clock = new Clock()) {}
}
__laratype_deps(Notifier, [() => MAILER, { unresolved: "string", index: 1 }, () => Clock],
  { params: ["mailer", "name", "clock"], optional: [2] });
```

### Invariants
- **Which classes:** every class with an **own constructor implementation** emits a call. A class with no own constructor emits nothing, so the runtime walks to the parent. An explicit `constructor() {}` emits `[]`. `constructor(...args) { super(...args) }` (first param is a rest) counts as no own constructor. `declare class` and overload signatures are skipped.
- **Returns `null`** when the file contains no `constructor` (a fast pre-check), when nothing is emitted, or on a syntax error, which SWC then reports.
- **Slots,** one per param, never skipped (a trailing rest gets none):

  | Param type | Slot |
  |---|---|
  | `@Inject(TOKEN)` (direct, aliased `Inject as X`, `ns.Inject`, or `injectNames`) | `() => TOKEN` (the type is ignored) |
  | Local class, value-imported name | `() => Name` |
  | `ns.Foo` where `ns` is a runtime value (`import * as ns`, TS namespace) | `() => ns.Foo` |
  | Generic `Repo<User>` | `() => Repo` (type args erased, so `Repo<User>` and `Repo<Post>` collide on one key; use a token to separate them) |
  | `Foo \| undefined`, `Foo \| null` | `() => Foo`, index added to `optional` |
  | `import type` / `{ type X }`, interface, type alias, type param, local enum, primitive, other union, array, function type, literal, `typeof x`, unbound global (`Date`, `Map`, `Promise`), ambient class, missing annotation | `{ unresolved: "<type text>", index }` (`"unknown"` when there is no annotation) |

- **`optional`** lists the indices of `?` params, params with a default, and nullable unions. A resolvable class type is still injected, so its JS default is ignored. Only an unresolved slot (or a thunk that returns `undefined`) falls back to `undefined`, which lets the default apply. An *imported* enum can't be told apart from a class, so it becomes a thunk. `meta.params` holds the param names (`#<i>` for destructured params).
- **Placement, class declarations:** the call is a statement placed **after** the class. Under SWC legacy decorators it therefore runs after `X = _ts_decorate(...)` and registers the final binding. An anonymous `export default class {}` gets the binding name `__laratype_default`, so its `.name` changes from `"default"`.
- **Placement, class expressions:** the expression is wrapped in place, `__laratype_deps(class { ... }, [slots], meta)`. Where NamedEvaluation would name the class, the wrap keeps the name: `const Expr = __laratype_deps({ "Expr": class { ... } }["Expr"], [slots], meta)`. That covers `const X = class {}`, assignments (`=`, `||=`, `&&=`, `??=`), object properties, static fields, defaults, casts and `export default`. A class expression passed as a call argument keeps its empty name, as before. See the T3 snapshot [`__snapshots__/class-expression/main.ts` @ 8a8e9c7](https://github.com/Laratypes/Laratype/blob/8a8e9c71f9b6d3e7677a77ace2b6695560a74619/packages/sauf/__tests__/di/__snapshots__/class-expression/main.ts).
- **Helper import:** added once, after directives and any hashbang. If the file already has an identifier named `__laratype_deps`, the helper is aliased `__laratype_deps_1`, `_2`, and so on (only identifiers count, not strings or comments).
- **Scope model:** resolution honours declaration merging, class type params, function and block scopes, hoisted `var`, namespaces, and nested shadowing. A type name whose runtime value is shadowed at a different depth becomes unresolved.
- **Source maps:** the transform returns a magic-string map (`hires: 'boundary'`) with correct UTF-16 offsets for non-ASCII source. The transform doesn't chain maps itself. The T3 test pipeline (`__tests__/di/support/pipeline.ts`) chains it into SWC via `inputSourceMap`, and the Vite wiring is T2 [#102](https://github.com/Laratypes/Laratype/issues/102).
- **Cost** (S3): about 0.3 ms warm for 43 files with the pre-check.

### Diagnostics
The transform never throws on user code. Resolve-time failures surface as [Container](#container) `DiError`s.

### Example
Output snapshots: `packages/sauf/__tests__/di/` on PR #199 (`bun run test:di`).

### Non-goals
- No type checker. Decisions are purely syntactic, so inferred or aliased types that need checking are `{ unresolved }`.
- No `importStrategy: 'namespace'` (dropped from the S3 spike; `verbatimModuleSyntax` covers the case).
- No method params (see [#158](https://github.com/Laratypes/Laratype/issues/158)).

### Open questions
- Known review findings on PR #194: `__laratype_default` is not collision-aliased, and the inferred name `__proto__` loses the class name → [#101](https://github.com/Laratypes/Laratype/issues/101).
- CI wiring of `bun run test:di` → [#189](https://github.com/Laratypes/Laratype/issues/189).

### Acceptance
[#101 Done when](https://github.com/Laratypes/Laratype/issues/101) · [#103 Done when](https://github.com/Laratypes/Laratype/issues/103)

---

## ServiceProvider v2 and kernel boot

### Status
proposed: PR #202 @ 18c01f5 (D4 [#99](https://github.com/Laratypes/Laratype/issues/99); stacked on PR #196).

### Public API
[`ServiceProvider.ts` @ 18c01f5](https://github.com/Laratypes/Laratype/blob/18c01f5e65b30cb27bdf9d31cfaead69fca5fdcf/packages/support/src/ServiceProvider.ts#L1-L86) · [`serve.ts` @ 18c01f5](https://github.com/Laratypes/Laratype/blob/18c01f5e65b30cb27bdf9d31cfaead69fca5fdcf/packages/laratype/src/serve.ts)

```ts
// @laratype/support
export enum ServiceProviderType {
  CORE_PROVIDER = "core_provider",
  APP_PROVIDER = "app_provider",
  ROUTE_PROVIDER = "route_provider",
}
export const HTTP_APP: InjectionToken<Hono>;              // TEMPORARY: kept on globalThis until #188 (B13)
export class ServiceProvider {
  static type: ServiceProviderType;                        // ServiceProviderType.CORE_PROVIDER
  readonly app: Container;
  constructor(app: Container);
  register(): void | Promise<void>;                        // bindings only
  boot(): void | Promise<void>;                            // all bindings available
  down(): Promise<void>;
}
export class AppServiceProvider extends ServiceProvider {
  static type: ServiceProviderType;                        // ServiceProviderType.APP_PROVIDER
  apps: Hono;                                              // = app.make(HTTP_APP)
  bindings: [];                                            // unused 0.5 leftover
}
export abstract class RouteAppServiceProvider extends AppServiceProvider {
  static type: ServiceProviderType;                        // ServiceProviderType.ROUTE_PROVIDER
  abstract routes(): Array<Record<string, any>>;
}
export function bootProviders(app: Container, Providers: Array<typeof ServiceProvider>): Promise<Array<() => Promise<void>>>;

// laratype: `Serve` is the default export of serve.ts, re-exported by name
export { default as Serve } from "./serve";   // class Serve { static getContainer(): Container; /* abridged */ }
export { bootProviders } from "@laratype/support";
```

### Invariants
- **Two phases:** `bootProviders` instantiates every provider with the container, awaits `register()` on all of them in order, then awaits `boot()` on all of them in order. It returns the `down()` cleanups in **reverse** order.
- Providers receive the **container**, not the Hono app. Code that needs the app resolves `HTTP_APP` (`AppServiceProvider.apps` does this in its constructor).
- `Serve.getContainer()` lazily creates one container per process and binds `HTTP_APP` to `Serve.getInstance()`. `Serve.down()` resets both. Both the HTTP kernel and `sauf` commands boot providers through `bootProviders`.
- `HTTP_APP` is stored on `globalThis.__laratype_http_app_token`, because every package dist currently inlines its own copy of `@laratype/support`. It becomes a plain module-level `token()` after [#188](https://github.com/Laratypes/Laratype/issues/188) (B13).
- `RouteAppServiceProvider.boot()` still writes `globalThis.__laratype_routes`, which is replaced in [#114](https://github.com/Laratypes/Laratype/issues/114). `AppServiceProvider.bindings` is an unused 0.5 leftover.

### Diagnostics
None of its own. Errors thrown in `register()` or `boot()` propagate and abort the boot.

### Example
[`examples/di/proposed/provider.ts`](./examples/di/proposed/provider.ts) (checked against PR #202 @ 18c01f5).

### Non-goals
- No `defineModule`. Modules are K2 [#153](https://github.com/Laratypes/Laratype/issues/153), see [Modules](#modules).
- No deferred providers.

### Open questions
- `Serve.getContainer()` creates `new Container()` without `{ deps: depsRegistry }`, so the kernel can only autowire zero-arg classes. After D2 and D4 merge, T2 switches it to `new Container({ deps: depsRegistry })` → [#102 comment](https://github.com/Laratypes/Laratype/issues/102#issuecomment-6084336635).

### Acceptance
[#99 Done when](https://github.com/Laratypes/Laratype/issues/99)

---

## Decorators: @Inject and @Injectable

### Status
planned → [#98](https://github.com/Laratypes/Laratype/issues/98) (D3). No runtime `Inject` or `Injectable` exists in any package yet. The T1/T3 tests use a test-only stub (`packages/sauf/__tests__/di/support/runtime.ts`). Both will be exported from `@laratype/core`. Signatures are not specified until #98 lands.

### Design (non-binding)
- `@Inject(token)` is a parameter decorator for interfaces, primitives and generics. The transform already reads it syntactically and emits `() => TOKEN`. At runtime it must still record `(class, index) → token`, so the container can detect a disagreement with the transform. That happens with wrapper decorators, which the transform can't see (S3 finding #9: `Conflicting metadata for <C> constructor param #<i> ...`).
- `@Injectable({ scope })` is optional, for non-default scopes only.
- It must work with the SWC legacy decorator config in `packages/sauf/src/bin/warmup.ts`.

### Open questions
- Export location (`@laratype/core`) and a T1 fixture that imports `Inject` from it → [#98 comment](https://github.com/Laratypes/Laratype/issues/98#issuecomment-6084336050).

### Acceptance
[#98 Done when](https://github.com/Laratypes/Laratype/issues/98)

---

## Vite plugin `laratype:di`

### Status
planned → [#102](https://github.com/Laratypes/Laratype/issues/102) (T2).

### Design (non-binding)
- The plugin runs `transformDi` with `enforce: 'pre'`, before `RollupPluginSwc` in `warmup.ts`.
- It resolves `virtual:laratype/di` to `@laratype/core` and chains source maps.
- It must work with the HMR restart in `dev.ts`.
- Done when `sauf dev` on `examples/basic` resolves a controller that uses constructor DI.

### Acceptance
[#102 Done when](https://github.com/Laratypes/Laratype/issues/102)

---

## Resolution errors with fix hints

### Status
planned → [#100](https://github.com/Laratypes/Laratype/issues/100) (D5a). D1 already throws the base messages listed under [Container](#container).

### Design (non-binding)
Each message names the class, the param index and name, and a hint. The S3 spike wording:
- `Fix: add @Inject(token) to the parameter, or import the class as a value (not \`import type\`).`
- `It is probably an interface/type imported without \`import type\`, or a circular import evaluated too early. Fix: use \`import type\` + @Inject(token), or import the class as a value.`

Snapshot tests cover the messages.

### Acceptance
[#100 Done when](https://github.com/Laratypes/Laratype/issues/100)

---

## Request scope and scope bubbling

### Status
planned → [#112](https://github.com/Laratypes/Laratype/issues/112) (D6).

### Design (non-binding)
- Adds the third scope, `request`: a per-request cache in the AsyncLocalStorage store of `packages/support/src/context/ContextApi.ts`, disposed when the request ends.
- **Scope bubbling:** a controller that depends on a request-scoped provider becomes request-scoped, with a dev warning.
- Also settles the D1 carry-overs (autowire default scope, `has()`, runtime abstract guard).

### Acceptance
[#112 Done when](https://github.com/Laratypes/Laratype/issues/112)

---

## Boot-time graph diagnostics

### Status
planned → [#113](https://github.com/Laratypes/Laratype/issues/113) (D5b).

### Design (non-binding)
Eager graph validation at boot, used by the `sauf build` verify step (B5 [#129](https://github.com/Laratypes/Laratype/issues/129)). It covers instance cycles with the token chain printed, singleton → request scope violations, and warnings for unused bindings.

### Acceptance
[#113 Done when](https://github.com/Laratypes/Laratype/issues/113)

---

## Container-backed registries and facades

### Status
planned → [#114](https://github.com/Laratypes/Laratype/issues/114) (D7), [#115](https://github.com/Laratypes/Laratype/issues/115) (D8).

### Design (non-binding)
- **D7:** replace `globalThis.__laratype_routes`, `__laratype_route_model_bindings`, `__laratype_param_model_map` and `__laratype_db` with the container bindings `RouteRegistry`, `ModelBindingRegistry` and `DataSource`.
- **D8:** a base `Facade` proxy over the container. `Auth`, `Log`, `Hash` and `Mail` become facades. Tests use `app.swap()` and `Facade.fake()`.

### Acceptance
[#114 Done when](https://github.com/Laratypes/Laratype/issues/114) · [#115 Done when](https://github.com/Laratypes/Laratype/issues/115)

---

## Bun build plugin

### Status
planned → [#116](https://github.com/Laratypes/Laratype/issues/116) (T4).

### Design (non-binding)
Exposes the same core transform as a Bun plugin in `bun.build.js`, so that framework classes resolved by the container work from `dist/`.

### Acceptance
[#116 Done when](https://github.com/Laratypes/Laratype/issues/116)

---

## Method injection

### Status
planned → [#158](https://github.com/Laratypes/Laratype/issues/158) (T5, M3).

### Design (non-binding)
The transform also emits deps for handler params after `ctx` (`async store(ctx, mailer: Mailer)`) and for job `handle()` methods (Q1 [#169](https://github.com/Laratypes/Laratype/issues/169)). Constructor injection remains the primary style.

### Acceptance
[#158 Done when](https://github.com/Laratypes/Laratype/issues/158)

---

## Modules

### Status
planned → [#153](https://github.com/Laratypes/Laratype/issues/153) (K2, M3). Depends on D4 #99.

### Design (non-binding)
- **Optional:** NestJS-style modules for large apps split by domain. An app made of plain providers keeps working.
- **Shape:** `defineModule({ providers, routes, imports })`, where `providers` lists `ServiceProvider` classes ([ServiceProvider v2 and kernel boot](#serviceprovider-v2-and-kernel-boot)), `routes` lists route groups ([http.md › Router v2](./http.md#router-v2)) and `imports` lists other modules.
- **Layout:** modules sit in the optional `app/modules/` ([overview.md › Project structure](./overview.md#project-structure)).

### Open questions
- How a module is registered with the kernel → [#153](https://github.com/Laratypes/Laratype/issues/153)

### Acceptance
[#153 Done when](https://github.com/Laratypes/Laratype/issues/153)
