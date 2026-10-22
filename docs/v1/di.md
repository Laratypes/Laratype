---
area: di
packages: ["@laratype/core", "sauf", "@laratype/support", "laratype"]
issues: [96, 97, 98, 99, 100, 101, 102, 103, 112, 113, 114, 115, 116, 153, 158]
verified-against: Laratype@d9e8df2
last-verified: 2026-10-12
---

# Dependency injection

Constructor injection works without mandatory decorators. A build transform (oxc, before SWC) records each constructor's dependencies as lazy thunks. A container resolves them: concrete classes autowire, and interfaces or primitives go through a typed token. Service providers bind things into the container in two phases (`register()` → `boot()`).

On master: D1 (container, tokens, dependency metadata), D2 (deps registry), D3 (`@Inject` and `@Injectable`), D4 (ServiceProvider v2 and kernel boot), D5a (resolution errors with fix hints), T1 (the DI transform core), T2 (the `laratype:di` Vite plugin in `sauf dev`) and T3 (its snapshot and runtime tests) are merged. The transform is not wired into `sauf build` yet, and the other sections are planned.

Canonical API: the exports of `packages/core/src/index.ts`, `packages/sauf/src/di/index.ts` and `packages/support/src/ServiceProvider.ts` at the SHAs below. Executable spec: `packages/core/__tests__/`, `packages/sauf/__tests__/di/` and `packages/support/__tests__/ServiceProvider.test.ts`.

| Section | Status |
|---|---|
| [Tokens](#tokens) | merged @ cfa85c3 |
| [Container](#container) | merged @ cfa85c3 |
| [Dependency metadata](#dependency-metadata) | merged @ cfa85c3 |
| [Deps registry](#deps-registry) | merged @ 36ba917 |
| [DI transform](#di-transform) | merged @ 8dc389b; tests merged @ d9e8df2; abstract-class flag merged (#101) |
| [ServiceProvider v2 and kernel boot](#serviceprovider-v2-and-kernel-boot) | merged @ 468c2ec |
| [Decorators: @Inject and @Injectable](#decorators-inject-and-injectable) | merged ([#98](https://github.com/Laratypes/Laratype/issues/98)) |
| [Vite plugin `laratype:di`](#vite-plugin-laratypedi) | merged ([#102](https://github.com/Laratypes/Laratype/issues/102)) |
| [Resolution errors with fix hints](#resolution-errors-with-fix-hints) | merged ([#100](https://github.com/Laratypes/Laratype/issues/100)); no-metadata hint proposed: PR [#294](https://github.com/Laratypes/Laratype/pull/294) @ 40faad5 |
| [Request scope and scope bubbling](#request-scope-and-scope-bubbling) | planned → #112 |
| [Boot-time graph diagnostics](#boot-time-graph-diagnostics) | planned → #113 |
| [Container-backed registries and facades](#container-backed-registries-and-facades) | planned → #114, #115 |
| [Bun build plugin](#bun-build-plugin) | planned → #116 |
| [Method injection](#method-injection) | planned → #158 |
| [Modules](#modules) | planned → #153 |

Area rules (S3 [#86](https://github.com/Laratypes/Laratype/issues/86), [FINDINGS.md](https://github.com/Laratypes/Laratype/blob/bddc5d8c56c18c2bced6594e87c5b757ba3709c3/spikes/v1/s3-di/FINDINGS.md)):
- App code must use `import type` for type-only imports (`verbatimModuleSyntax`). An interface imported as a value fails in different ways: a Node ESM link error, `vite build` "is not exported", or a resolve-time `DiError` in `sauf dev`. The repo-wide migration (B11 [#185](https://github.com/Laratypes/Laratype/issues/185)) is merged @ f66eafd.
- SWC `decoratorMetadata` stays `true` while TypeORM is in use (S5 [#88](https://github.com/Laratypes/Laratype/issues/88)).
- Runtime diagnostics are kept, because in `sauf dev` they are the only signal.

---

## Tokens

### Status
merged @ cfa85c3 (D1 [#96](https://github.com/Laratypes/Laratype/issues/96)).

### Public API
[`token.ts` @ cfa85c3](https://github.com/Laratypes/Laratype/blob/cfa85c316eba81eb077a48a6a1994a7c36e00c7c/packages/core/src/token.ts#L1-L18)

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
[`examples/di/container.ts`](./examples/di/container.ts).

### Non-goals
- No string or symbol keys. Use a token.

### Open questions
- None recorded.

### Acceptance
[#96 Done when](https://github.com/Laratypes/Laratype/issues/96)

---

## Container

### Status
merged @ cfa85c3 (D1 [#96](https://github.com/Laratypes/Laratype/issues/96)).

### Public API
[`container.ts` @ cfa85c3](https://github.com/Laratypes/Laratype/blob/cfa85c316eba81eb077a48a6a1994a7c36e00c7c/packages/core/src/container.ts#L1-L180)

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
- **Autowire:** `make(Cls)` with no binding builds the class from the deps lookup, so unregistered concrete classes need no registration. Autowired classes are **transient**, Laravel-style ([#112](https://github.com/Laratypes/Laratype/issues/112)). A singleton needs an explicit binding or `@Injectable({ scope })` ([#98](https://github.com/Laratypes/Laratype/issues/98)).
- **Resolution order:** look up the binding through the parent chain. If none is found and the key is a class, autowire it. Otherwise throw.
- **Singletons** are built by the container that **owns** the binding, so a child's overrides never leak into a shared instance. The first result is cached. Rebinding replaces both the binding and its cached instance.
- **Children** (`createChild`) see the parent's bindings, and their own bindings shadow them without touching the parent. Transient parent bindings and autowired classes resolve with the child's overrides.
- **Self-binding:** `bind(Cls)` / `singleton(Cls)` without a concrete binds the class to itself. Tokens and abstract classes cannot self-bind (type error, plus a runtime `DiError` for tokens).
- **`has()`** counts explicit bindings only (searching up the chain). Autowirable classes don't count ([#112](https://github.com/Laratypes/Laratype/issues/112)).
- **Cycles:** the keys being resolved are tracked across the whole container tree, factories included. A cycle throws, and the container recovers for later resolutions.
- **Constructor params** come from the `DepsLookup` (see [Dependency metadata](#dependency-metadata)). A slot listed in `meta.optional` resolves to `undefined` when it is unresolved, or when its thunk returns `undefined`, so a JS default applies. Without metadata, only zero-arg classes can be built.
- `optional` only covers an unresolved slot or a thunk returning `undefined`. If the thunk returns a key that fails to resolve (for example an unbound token), `make()` still throws.
- Abstract classes are guarded at the type level only in D1. The runtime guard is decided ([#112](https://github.com/Laratypes/Laratype/issues/112)): the [DI transform](#di-transform) flags every `abstract` class, and resolving a flagged class without a binding throws `No binding for abstract class <C>.` instead of autowiring it. The flag is read from the class itself only (`isAbstract()`), never inherited. The flag ([#101](https://github.com/Laratypes/Laratype/issues/101)) and the error ([#100](https://github.com/Laratypes/Laratype/issues/100)) are merged.

### Diagnostics
`DiError` messages (exact text; `<C>` is the class name or `<anonymous class>`, tokens print as `InjectionToken(<name>)`):
- `No binding for <key>.`
- `No binding for abstract class <C>.`
- `Cannot bind <key> to itself: only a class can be self-bound.`
- `Cannot autowire <C>: its constructor takes <n> param(s) but no dependency metadata was found.`
- `Cannot resolve <C> constructor param #<i> \`<name>\`: type \`<TypeText>\` has no runtime value.`
- `Cannot resolve <C> constructor param #<i> \`<name>\`: its type resolved to undefined at runtime.`
- `Circular dependency: A -> B -> A`

The `` `<name>` `` part appears only when `meta.params` has a name. Each message above is the first sentence of the thrown text: resolution errors append a fix hint, listed under [Resolution errors with fix hints](#resolution-errors-with-fix-hints).

Type-only (`container.types.test.ts`): binding an unrelated class, a factory with the wrong return type, `instance()` with the wrong value type, self-binding an abstract class or a token.

### Example
[`examples/di/container.ts`](./examples/di/container.ts)

### Non-goals
- No decorators in D1 (see [#98](https://github.com/Laratypes/Laratype/issues/98)).
- No async factories or async resolution.
- No eager boot-time validation (see [#113](https://github.com/Laratypes/Laratype/issues/113)).

### Open questions
- Resolved: autowired classes default to transient, `has()` counts explicit bindings only, and abstract classes get a runtime guard through a transform flag ([#112](https://github.com/Laratypes/Laratype/issues/112)).
- **Interim behaviour:**
  - The container detects `@Inject`-vs-thunk conflicts (S3 condition 3) through the runtime decorator records ([Decorators](#decorators-inject-and-injectable)), with a fix hint ([Resolution errors with fix hints](#resolution-errors-with-fix-hints)).

### Acceptance
[#96 Done when](https://github.com/Laratypes/Laratype/issues/96)

---

## Dependency metadata

### Status
merged @ cfa85c3 (D1 [#96](https://github.com/Laratypes/Laratype/issues/96)).

### Public API
[`deps.ts` @ cfa85c3](https://github.com/Laratypes/Laratype/blob/cfa85c316eba81eb077a48a6a1994a7c36e00c7c/packages/core/src/deps.ts#L1-L36)

```ts
export interface UnresolvedSlot { unresolved: string; index: number }
export type DepSlot = (() => unknown) | UnresolvedSlot;   // lazy thunk to the key, or a marker for a type with no runtime value
export interface DepsMeta { params: string[]; optional?: number[]; abstract?: true }  // abstract: see isAbstract()
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
[`examples/di/container.ts`](./examples/di/container.ts)

### Non-goals
- No metadata for methods (see [#158](https://github.com/Laratypes/Laratype/issues/158)).

### Open questions
- None recorded.

### Acceptance
[#96 Done when](https://github.com/Laratypes/Laratype/issues/96)

---

## Deps registry

### Status
merged @ 36ba917 (D2 [#97](https://github.com/Laratypes/Laratype/issues/97)).

### Public API
[`registry.ts` @ 36ba917](https://github.com/Laratypes/Laratype/blob/36ba91736f5364f5f13c5cb662f70f8006329228/packages/core/src/registry.ts#L1-L64)

```ts
export function __laratype_deps<T extends Function>(cls: T, slots: DepSlot[] | null, meta?: DepsMeta): T;  // returns cls unchanged
export function hasOwnDeps(cls: Function): boolean;
export function isAbstract(cls: Function): boolean;  // own flag only, never inherited
export function getDeps(cls: Function): { owner: Function; entry: DepsEntry } | undefined;
export const depsRegistry: DepsLookup;     // new Container({ deps: depsRegistry })
```

### Invariants
- `__laratype_deps` is the call the [DI transform](#di-transform) emits. It stores the entry as an **own, non-enumerable, configurable** property under `Symbol.for('laratype.di.deps')`:
  - `configurable`, so an HMR re-run can register the class again;
  - `Symbol.for`, so two copies of `@laratype/core` in one bundle agree on the key.
- `meta.abstract` also sets an own flag under `Symbol.for('laratype.di.abstract')`, read by `isAbstract()`. With `slots: null` only the flag is stored, and no deps entry ([DI transform › Abstract classes](#di-transform)).
- `getDeps` walks from `cls` up the prototype chain. At each class it uses, in order:
  1. its own registered entry;
  2. otherwise its own `design:paramtypes`, for third-party decorated classes, only when `reflect-metadata` is loaded;
  3. otherwise it moves to the parent.

  So a class with its own constructor uses only its own params, and a class without one inherits the nearest ancestor's.
- In the `design:paramtypes` fallback, `undefined`, `Object`, `String`, `Number`, `Boolean`, `Symbol`, `BigInt`, `Function`, `Array` and `Promise` become `{ unresolved }` slots (interfaces erase to `Object`). That entry has `meta.params = []`.
- `virtual:laratype/di` (the transform's helper import) maps to `@laratype/core` through the [Vite plugin `laratype:di`](#vite-plugin-laratypedi), merged ([#102](https://github.com/Laratypes/Laratype/issues/102)).
- `reflect-metadata` is a devDependency of `@laratype/core` (tests only). The package never imports it.

### Diagnostics
None of its own. Resolution errors come from the [Container](#container).

### Example
[`examples/di/container.ts`](./examples/di/container.ts) calls `__laratype_deps` by hand to show what the transform emits.

### Non-goals
- No `@Inject` override records (see [#98](https://github.com/Laratypes/Laratype/issues/98)).

### Open questions
- None recorded.

### Acceptance
[#97 Done when](https://github.com/Laratypes/Laratype/issues/97)

---

## DI transform

### Status
merged @ 8dc389b (T1 [#101](https://github.com/Laratypes/Laratype/issues/101)). Snapshot and runtime tests merged @ d9e8df2 (T3 [#103](https://github.com/Laratypes/Laratype/issues/103)). The abstract-class flag is merged ([#101](https://github.com/Laratypes/Laratype/issues/101)). Wired into `sauf dev` by the [Vite plugin `laratype:di`](#vite-plugin-laratypedi), merged ([#102](https://github.com/Laratypes/Laratype/issues/102)). Not wired into `sauf build` yet (planned → [#116](https://github.com/Laratypes/Laratype/issues/116)).

### Public API
[`transform.ts` @ 8dc389b](https://github.com/Laratypes/Laratype/blob/8dc389b41cc4f862a3ec2cfcce71e7ca14b9683d/packages/sauf/src/di/transform.ts#L1-L95)

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
- **Abstract classes** (decided on [#112](https://github.com/Laratypes/Laratype/issues/112)): every `abstract` class is flagged with `abstract: true` in its meta.
  - With an own constructor, the flag is added to the normal call: `__laratype_deps(Port, [() => Clock], { params: ["clock"], abstract: true })`.
  - Without one (or with a rest pass-through), the call is flag-only: `__laratype_deps(Mid, null, { params: [], abstract: true })`. `null` slots register no deps entry, so a subclass still inherits the nearest ancestor's constructor deps.
  - The flag is stored apart from the deps entry and read with `isAbstract(cls)`, which checks the class itself only. It is never inherited. The container uses it for the runtime guard ([Container](#container)).
- **Returns `null`** when the file contains neither `constructor` nor `abstract` (a fast pre-check), when nothing is emitted, or on a syntax error, which SWC then reports.
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
- **Placement, class declarations:** the call is a statement placed **after** the class. Under SWC legacy decorators it therefore runs after `X = _ts_decorate(...)` and registers the final binding. An anonymous `export default class {}` gets the binding name `__laratype_default`, so its `.name` changes from `"default"`. If the file already has an identifier with that name, the binding is aliased `__laratype_default_1`, `_2`, and so on.
- **Placement, class expressions:** the expression is wrapped in place, `__laratype_deps(class { ... }, [slots], meta)`. Where NamedEvaluation would name the class, the wrap keeps the name: `const Expr = __laratype_deps({ ["Expr"]: class { ... } }["Expr"], [slots], meta)`. The key is computed, so a name of `__proto__` defines a property instead of setting the prototype. A class written as the value of `{ __proto__: class {} }` keeps the empty name, as in plain JS. That covers `const X = class {}`, assignments (`=`, `||=`, `&&=`, `??=`), object properties, static fields, defaults, casts and `export default`. A class expression passed as a call argument keeps its empty name, as before. See the T3 snapshot [`__snapshots__/class-expression/main.ts` @ 3aadec9](https://github.com/Laratypes/Laratype/blob/3aadec97eb5c5d05c8b09aa2b53e0303d8b55b26/packages/sauf/__tests__/di/__snapshots__/class-expression/main.ts).
- **Helper import:** added once, after directives and any hashbang. If the file already has an identifier named `__laratype_deps`, the helper is aliased `__laratype_deps_1`, `_2`, and so on (only identifiers count, not strings or comments).
- **Scope model:** resolution honours declaration merging, class type params, function and block scopes, hoisted `var`, namespaces, and nested shadowing. A type name whose runtime value is shadowed at a different depth becomes unresolved.
- **Source maps:** the transform returns a magic-string map (`hires: 'boundary'`) with correct UTF-16 offsets for non-ASCII source. The transform doesn't chain maps itself. The T3 test pipeline (`__tests__/di/support/pipeline.ts`) chains it into SWC via `inputSourceMap`. In `sauf dev`, the [Vite plugin](#vite-plugin-laratypedi) returns it and Vite composes it with SWC's.
- **Cost** (S3): about 0.3 ms warm for 43 files with the pre-check.

### Diagnostics
The transform never throws on user code. Resolve-time failures surface as [Container](#container) `DiError`s.

### Example
Output snapshots: `packages/sauf/__tests__/di/` (`bun run test:di`). CI runs them since b560fc9.

### Non-goals
- No type checker. Decisions are purely syntactic, so inferred or aliased types that need checking are `{ unresolved }`.
- No `importStrategy: 'namespace'` (dropped from the S3 spike; `verbatimModuleSyntax` covers the case).
- No method params (see [#158](https://github.com/Laratypes/Laratype/issues/158)).

### Open questions
- None recorded.

### Acceptance
[#101 Done when](https://github.com/Laratypes/Laratype/issues/101) · [#103 Done when](https://github.com/Laratypes/Laratype/issues/103)

---

## ServiceProvider v2 and kernel boot

### Status
merged @ 468c2ec (D4 [#99](https://github.com/Laratypes/Laratype/issues/99)).

### Public API
[`ServiceProvider.ts` @ 468c2ec](https://github.com/Laratypes/Laratype/blob/468c2ec5b2ba51e92d52ebcd25c41128ea39067c/packages/support/src/ServiceProvider.ts#L1-L86) · [`serve.ts` @ 468c2ec](https://github.com/Laratypes/Laratype/blob/468c2ec5b2ba51e92d52ebcd25c41128ea39067c/packages/laratype/src/serve.ts)

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
- `Serve.getContainer()` lazily creates one container per process, `new Container({ deps: depsRegistry })` ([#102](https://github.com/Laratypes/Laratype/issues/102)), and binds `HTTP_APP` to `Serve.getInstance()`. `Serve.down()` resets both. Both the HTTP kernel and `sauf` commands boot providers through `bootProviders`.
- `HTTP_APP` is stored on `globalThis.__laratype_http_app_token`. The code marks this as temporary: it was needed while every package dist inlined its own copy of `@laratype/support`, which B13 [#188](https://github.com/Laratypes/Laratype/issues/188) fixed.
- `RouteAppServiceProvider.boot()` still writes `globalThis.__laratype_routes`, which is replaced in [#114](https://github.com/Laratypes/Laratype/issues/114). `AppServiceProvider.bindings` is an unused 0.5 leftover.

### Diagnostics
None of its own. Errors thrown in `register()` or `boot()` propagate and abort the boot.

### Example
[`examples/di/provider.ts`](./examples/di/provider.ts).

### Non-goals
- No `defineModule`. Modules are K2 [#153](https://github.com/Laratypes/Laratype/issues/153), see [Modules](#modules).
- No deferred providers.

### Open questions
- Resolved: `Serve.getContainer()` passes `{ deps: depsRegistry }`, so the kernel autowires classes with constructor deps ([#102 comment](https://github.com/Laratypes/Laratype/issues/102#issuecomment-6084336635)).

### Acceptance
[#99 Done when](https://github.com/Laratypes/Laratype/issues/99)

---

## Decorators: @Inject and @Injectable

### Status
merged ([#98](https://github.com/Laratypes/Laratype/issues/98)).

### Public API
[`decorators.ts`](../../packages/core/src/decorators.ts)

```ts
export interface InjectableOptions { scope?: Scope }   // default 'transient'
export function Inject<T>(token: Token<T>):
  (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => void;   // constructor param decorator
export function Injectable(options?: InjectableOptions): (target: Function) => void;           // class decorator
```

### Invariants
- **Legacy decorators only:** both are TypeScript `experimentalDecorators`. They work with the SWC config in `packages/sauf/src/bin/warmup.ts` (`legacyDecorator: true`), with `decoratorMetadata` on or off.
- **`@Inject(token)`** marks a constructor param that has no runtime class (an interface, a primitive, or a generic that needs its own key). The [DI transform](#di-transform) reads it syntactically and emits `() => TOKEN`. At runtime the decorator also records `index → token` as an own, non-enumerable, configurable property of the class, under `Symbol.for('laratype.di.inject')`.
- **How the container uses the record**, for the class that owns the constructor (`getDeps(cls).owner`, so a class without its own constructor uses its parent's records):
  - An `{ unresolved }` slot, or a thunk that returns `undefined`, resolves the record's token. This covers a wrapper decorator (`const InjectMailer = () => Inject(MAILER)`), which the transform can't see.
  - A thunk that returns a different key throws the conflict error below.
  - The record takes precedence over `optional`, so an unbound token still throws `No binding for <key>.`
- **`@Injectable({ scope })`** is optional and is needed only for a non-default lifetime. The scope belongs to the class itself and is not inherited by subclasses.
  - An autowired class (no binding) with `scope: 'singleton'` is built once per container tree. The root container builds and caches it, so a child's overrides never leak into it, and `has()` stays `false`.
  - `bind(Cls)` and `bind(TOKEN, Cls)` without a `scope` option use the class's scope. An explicit `scope`, `singleton()` or `transient()` wins.
  - `@Injectable()` without a scope changes nothing: the class stays transient.

### Diagnostics
`DiError` messages (exact text):
- `Conflicting metadata for <C> constructor param #<i> \`<name>\`: transform says <A>, @Inject says <B>.` followed by a fix hint ([Resolution errors with fix hints](#resolution-errors-with-fix-hints)).
- `@Inject() is only supported on constructor parameters (found on \`<method>\`).` This is thrown when the class is defined. Method injection is planned → [#158](https://github.com/Laratypes/Laratype/issues/158).

Type-only (`decorators.test.ts`): `Inject('name')` (a string key is not a token) and `Injectable({ scope: 'request' })`.

### Example
[`examples/di/decorators.ts`](./examples/di/decorators.ts). SWC pipeline fixture: `packages/sauf/__tests__/di/fixtures/inject-core/`.

### Non-goals
- No TC39 (stage 3) decorators: they have no parameter decorators.
- No `request` scope yet (see [#112](https://github.com/Laratypes/Laratype/issues/112)).

### Open questions
- Resolved: both are exported from `@laratype/core`, and the T1 fixture `inject-core` imports them from there ([#98 comment](https://github.com/Laratypes/Laratype/issues/98#issuecomment-6084336050)).

### Acceptance
[#98 Done when](https://github.com/Laratypes/Laratype/issues/98)

---

## Vite plugin `laratype:di`

### Status
merged ([#102](https://github.com/Laratypes/Laratype/issues/102)) (T2).

### Public API
[`packages/sauf/src/di/plugin.ts`](../../packages/sauf/src/di/plugin.ts)

```ts
export const DI_PLUGIN_NAME = 'laratype:di';
export const DI_RUNTIME_ID = '@laratype/core';                   // what `virtual:laratype/di` resolves to
export function laratypeDi(options?: DiTransformOptions): Plugin;  // Vite plugin; `options` go to `transformDi`
```

### Invariants
- **Order:** `enforce: 'pre'`, listed before `RollupPluginSwc` in `packages/sauf/src/bin/warmup.ts`, so `transformDi` reads the TypeScript param types before SWC erases them.
- **Which files:** app `.ts`, `.tsx`, `.mts` and `.cts` files under the Vite root, with any query stripped. It skips `node_modules`, `.d.ts` files, virtual ids (`\0…`, `virtual:…`) and files outside the root. In the monorepo, `sauf dev` loads the framework packages from their `src`, outside the app root, so they are not transformed and `@laratype/core` never imports itself.
- **Virtual module:** `virtual:laratype/di` resolves to `@laratype/core`, first from the importing file, then through `laratype` when the app does not depend on `@laratype/core` itself. The resolution goes through the rest of the plugin chain, so in dev it is the same `src` module as a direct `@laratype/core` import.
- **Source maps:** the plugin returns the transform's map, and Vite composes it with SWC's, so positions point at the original source.
- **HMR restart:** the plugin keeps no per-server state except the root, which it reads in `configResolved`. On a `--hmr` restart, `dev.ts` reboots the app on the same server and Vite transforms changed files again. `__laratype_deps` registrations are configurable, so a re-run class registers again.
- **Kernel container:** `Serve.getContainer()` creates `new Container({ deps: depsRegistry })` ([#102 comment](https://github.com/Laratypes/Laratype/issues/102#issuecomment-6084336635)), so the kernel autowires classes with constructor deps through the generated metadata.
- **Controllers:** the router resolves controllers with `app.make()`, for `Route.api` and 0.5 routes (merged, H2a [#105](https://github.com/Laratypes/Laratype/issues/105); [http.md › Controller resolution](./http.md#controller-resolution)). `examples/basic` also resolves its `GreetingController` from the kernel container in `RouteServiceProvider.boot()`.

### Diagnostics
None of its own. The transform never throws on user code, and resolve-time failures are [Container](#container) `DiError`s.

### Example
`examples/basic`: `GreetingService` is injected into `GreetingController`'s constructor with no decorator, and `GET /api/greeting` resolves the controller from the kernel container. Test: `packages/sauf/__tests__/di/plugin.test.ts` (DI transform → SWC through Vite SSR).

### Non-goals
- `sauf build` and the test preset don't use the plugin yet. The shared chain is B2 [#126](https://github.com/Laratypes/Laratype/issues/126).

### Open questions
- None recorded.

### Acceptance
[#102 Done when](https://github.com/Laratypes/Laratype/issues/102)

---

## Resolution errors with fix hints

### Status
merged ([#100](https://github.com/Laratypes/Laratype/issues/100)). The `Cannot autowire` hint (D9 [#270](https://github.com/Laratypes/Laratype/issues/270)) is proposed: PR [#294](https://github.com/Laratypes/Laratype/pull/294) @ 40faad5.

### Public API
None of its own: the messages of the `DiError`s that `Container.make()` throws. The table is `errors` in [`container.ts`](../../packages/core/src/container.ts).

### Invariants
- Each message starts with the base sentence listed in the Diagnostics of [Container](#container) or [Decorators](#decorators-inject-and-injectable), unchanged, so a match on the base sentence keeps working. The hint follows it.
- A param is named as `<C> constructor param #<i>`, plus `` `<name>` `` when `meta.params` has a name.
- `No binding for …` adds `Required by <param>.` when a constructor param asked for the key (the nearest requester in a nested graph). This covers the key from a transform thunk and the token from an `@Inject` record. A key passed to `make()` directly has no `Required by` part.
- **Abstract classes:** a class flagged by the [DI transform](#di-transform) (`isAbstract(cls)`) with no binding throws instead of autowiring. The check reads the class's own flag, so a concrete subclass of an abstract class autowires normally, with the deps it inherits. A binding for the abstract class (`container.bind(Port, SmtpPort)`) resolves as usual.

### Diagnostics
`DiError` messages (exact text; `<P>` is `<C> constructor param #<i>` with its optional `` `<name>` ``, and `[Required by <P>.]` appears only when a param asked for the key):
- `No binding for <key>. [Required by <P>.] Fix: bind it in a service provider \`register()\`, e.g. \`container.bind(token, factory)\` or \`container.instance(token, value)\`.`
- `No binding for abstract class <C>. [Required by <P>.] Fix: bind it to a concrete class in a service provider \`register()\`, e.g. \`container.bind(<C>, Impl)\`.`
- `Cannot resolve <P>: type \`<TypeText>\` has no runtime value. Fix: add @Inject(token) to the parameter, or import the class as a value (not \`import type\`).`
- `Cannot resolve <P>: its type resolved to undefined at runtime. It is probably an interface/type imported without \`import type\`, or a circular import evaluated too early. Fix: use \`import type\` + @Inject(token), or import the class as a value.`
- `Conflicting metadata for <P>: transform says <A>, @Inject says <B>. Fix: use @Inject from @laratype/core directly (aliases/wrappers are invisible to the build transform).`
- `Cannot autowire <C>: its constructor takes <n> param(s) but no dependency metadata was found. Fix: compile the class with the laratype:di plugin (app code under sauf dev), or bind it with a factory in a service provider \`register()\` of the app container.` Every `make()` gets it, for named and anonymous classes ([#270](https://github.com/Laratypes/Laratype/issues/270)).

`Cannot bind …`, `Circular dependency: …` and the `@Inject()` placement error keep their base text.

Snapshot tests: [`packages/core/__tests__/errors.test.ts`](../../packages/core/__tests__/errors.test.ts).

### Example
See the snapshots in [`errors.test.ts`](../../packages/core/__tests__/errors.test.ts).

### Non-goals
- No eager validation of the whole graph at boot (see [Boot-time graph diagnostics](#boot-time-graph-diagnostics)).

### Open questions
- Resolved: the abstract-class guard reads the transform's own-class flag, never an inherited one ([#112](https://github.com/Laratypes/Laratype/issues/112)).

### Acceptance
[#100 Done when](https://github.com/Laratypes/Laratype/issues/100)

---

## Request scope and scope bubbling

### Status
planned → [#112](https://github.com/Laratypes/Laratype/issues/112) (D6).

### Design (non-binding)
- Adds the third scope, `request`: a per-request cache in the AsyncLocalStorage store of `packages/support/src/context/ContextApi.ts`, disposed when the request ends.
- **Scope bubbling:** a controller that depends on a request-scoped provider becomes request-scoped, with a dev warning.
- The D1 carry-overs are settled: autowired classes stay transient, `has()` counts explicit bindings only, and abstract classes get the transform-flag guard ([Container](#container)).

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
- **Shape:** `defineModule({ providers, routes, imports })`, where `providers` lists `ServiceProvider` classes ([ServiceProvider v2 and kernel boot](#serviceprovider-v2-and-kernel-boot)), `routes` lists the module's route wiring ([http.md › Router v2](./http.md#router-v2)): contract routes take their URL from the contract tree and have no prefix, and ad-hoc routes keep `Route.prefix(...)` and `group(...)`; `imports` lists other modules.
- **Layout:** modules sit in the optional `app/modules/` ([overview.md › Project structure](./overview.md#project-structure)).

### Open questions
- How a module is registered with the kernel → [#153](https://github.com/Laratypes/Laratype/issues/153)
- How a module's contracts fit the `app/api` contract tree and `Route.api` → [#153](https://github.com/Laratypes/Laratype/issues/153)

### Acceptance
[#153 Done when](https://github.com/Laratypes/Laratype/issues/153)
