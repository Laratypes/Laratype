---
area: di
packages: ["@laratype/core", "sauf", "@laratype/support", "laratype", "@laratype/log", "@laratype/auth"]
issues: [96, 97, 98, 99, 100, 101, 102, 103, 112, 113, 114, 115, 116, 153, 158]
verified-against: Laratype@d9e8df2
last-verified: 2026-10-12
---

# Dependency injection

Constructor injection works without mandatory decorators. A build transform (oxc, before SWC) records each constructor's dependencies as lazy thunks. A container resolves them: concrete classes autowire, and interfaces or primitives go through a typed token. Service providers bind things into the container in two phases (`register()` → `boot()`).

On master: D1 (container, tokens, dependency metadata), D2 (deps registry), D3 (`@Inject` and `@Injectable`), D4 (ServiceProvider v2 and kernel boot), D5a (resolution errors with fix hints), T1 (the DI transform core), T2 (the `laratype:di` Vite plugin in `sauf dev`) and T3 (its snapshot and runtime tests) are merged. D6 (request scope and scope bubbling) is proposed. The transform is not wired into `sauf build` yet; the framework package builds run it through the [Bun build plugin](#bun-build-plugin), proposed. The other sections are planned.

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
| [Request scope and scope bubbling](#request-scope-and-scope-bubbling) | proposed: PR [#327](https://github.com/Laratypes/Laratype/pull/327) @ dda9cbd |
| [Boot-time graph diagnostics](#boot-time-graph-diagnostics) | planned → #113 |
| [Container-backed registries and facades](#container-backed-registries-and-facades) | registries planned → #114; facades proposed: PR [#303](https://github.com/Laratypes/Laratype/pull/303) @ b1ca24d |
| [Bun build plugin](#bun-build-plugin) | proposed: PR #324 @ 6d0af35 |
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
- **Scopes in D1:** `transient` and `singleton`. `bind()` is transient unless `{ scope: 'singleton' }` is passed. The `request` scope is proposed in [Request scope and scope bubbling](#request-scope-and-scope-bubbling) ([#112](https://github.com/Laratypes/Laratype/issues/112)). Final scope names: `singleton | request | transient`.
- **Autowire:** `make(Cls)` with no binding builds the class from the deps lookup, so unregistered concrete classes need no registration. Autowired classes are **transient**, Laravel-style ([#112](https://github.com/Laratypes/Laratype/issues/112)). A singleton needs an explicit binding or `@Injectable({ scope })` ([#98](https://github.com/Laratypes/Laratype/issues/98)).
- **Resolution order:** look up the binding through the parent chain. If none is found and the key is a class, autowire it. Otherwise throw.
- **Singletons** are built by the container that **owns** the binding, so a child's overrides never leak into a shared instance. The first result is cached. Rebinding replaces both the binding and its cached instance.
- **Children** (`createChild`) see the parent's bindings, and their own bindings shadow them without touching the parent. Transient parent bindings and autowired classes resolve with the child's overrides.
- **Self-binding:** `bind(Cls)` / `singleton(Cls)` without a concrete binds the class to itself. Tokens and abstract classes cannot self-bind (type error, plus a runtime `DiError` for tokens).
- **`has()`** counts explicit bindings only (searching up the chain). Autowirable classes don't count ([#112](https://github.com/Laratypes/Laratype/issues/112)).
- **Cycles:** the keys being resolved are tracked across the whole container tree, factories included. A cycle throws, and the container recovers for later resolutions.
- **Constructor params** come from the `DepsLookup` (see [Dependency metadata](#dependency-metadata)). A slot listed in `meta.optional` resolves to `undefined` when it is unresolved, or when its thunk returns `undefined`, so a JS default applies. Without metadata, only zero-arg classes can be built.
- **Inherited metadata stops at a longer constructor:** when the entry that applies to a class was declared on an ancestor and the class declares more params than the entry has slots (`cls.length > entry.slots.length`), the class counts as having no metadata and `make()` throws `Cannot autowire`. That is a subclass with its own constructor that no transform has seen (`sauf build` runs none yet, B2 [#126](https://github.com/Laratypes/Laratype/issues/126)), for example an app controller extending a framework class that carries its own `[]` entry. A subclass without its own constructor (`cls.length === 0`) keeps inheriting.
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

The `` `<name>` `` part appears only when `meta.params` has a name. Each message above is the first sentence of the thrown text: resolution errors append a fix hint, listed under [Resolution errors with fix hints](#resolution-errors-with-fix-hints). `Cannot autowire <C>` also covers an entry inherited from an ancestor with fewer slots than `C`'s own constructor params ([Container](#container)).

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
- `DepsLookup.get(cls)` returns the entry that applies to `cls`: its own entry, or the nearest ancestor's while `cls` declares no more params than that entry has slots (`cls.length <= entry.slots.length`; a subclass without its own constructor has `cls.length === 0`). A class with its own constructor and more params than the inherited entry has slots has no applicable entry, so the container throws `Cannot autowire` instead of building it with the ancestor's arguments ([Container](#container)).
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

  So a class with its own constructor uses only its own params, and a class without one inherits the nearest ancestor's. An entry found on an ancestor is returned only while `cls.length <= entry.slots.length`; with a longer constructor `getDeps` returns `undefined`, the [fail-closed rule](#container).
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
merged @ 8dc389b (T1 [#101](https://github.com/Laratypes/Laratype/issues/101)). Snapshot and runtime tests merged @ d9e8df2 (T3 [#103](https://github.com/Laratypes/Laratype/issues/103)). The abstract-class flag is merged ([#101](https://github.com/Laratypes/Laratype/issues/101)). Wired into `sauf dev` by the [Vite plugin `laratype:di`](#vite-plugin-laratypedi), merged ([#102](https://github.com/Laratypes/Laratype/issues/102)). Not wired into `sauf build` yet (B2 [#126](https://github.com/Laratypes/Laratype/issues/126)). The framework package builds run it through the [Bun build plugin](#bun-build-plugin), proposed ([#116](https://github.com/Laratypes/Laratype/issues/116)).

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

Type-only (`decorators.test.ts`): `Inject('name')` (a string key is not a token) and an unknown scope (`Injectable({ scope: 'session' })`). `Injectable({ scope: 'request' })` is accepted since D6 ([Request scope and scope bubbling](#request-scope-and-scope-bubbling), proposed).

### Example
[`examples/di/decorators.ts`](./examples/di/decorators.ts). SWC pipeline fixture: `packages/sauf/__tests__/di/fixtures/inject-core/`.

### Non-goals
- No TC39 (stage 3) decorators: they have no parameter decorators.
- The `request` scope is specified in [Request scope and scope bubbling](#request-scope-and-scope-bubbling) (proposed, [#112](https://github.com/Laratypes/Laratype/issues/112)).

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
- **Controllers:** the router resolves controllers with `Request.container().make()`, for `Route.api` and 0.5 routes (merged, H2a [#105](https://github.com/Laratypes/Laratype/issues/105); [http.md › Controller resolution](./http.md#controller-resolution)). `examples/basic` also resolves its `GreetingController` from the kernel container in `RouteServiceProvider.boot()`.

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
proposed: PR [#327](https://github.com/Laratypes/Laratype/pull/327) @ dda9cbd (D6 [#112](https://github.com/Laratypes/Laratype/issues/112)).

### Public API
[`container.ts` @ 902190d](https://github.com/Laratypes/Laratype/blob/902190d81a1b2a10dc59d2a752b1d0df7c348e25/packages/core/src/container.ts#L21-L22) (`Scope`), [`scoped()`](https://github.com/Laratypes/Laratype/blob/902190d81a1b2a10dc59d2a752b1d0df7c348e25/packages/core/src/container.ts#L166-L171), [`createRequestScope()` and `dispose()`](https://github.com/Laratypes/Laratype/blob/902190d81a1b2a10dc59d2a752b1d0df7c348e25/packages/core/src/container.ts#L225-L260) · [`Request.ts` @ dda9cbd](https://github.com/Laratypes/Laratype/blob/dda9cbd2eb00f17f5feaa60920746a1a1d78d71b/packages/http/src/request/Request.ts#L347-L361) (`RequestKernel.boot()`) · [`disposeRequestScope()`](https://github.com/Laratypes/Laratype/blob/dda9cbd2eb00f17f5feaa60920746a1a1d78d71b/packages/http/src/request/Request.ts#L373-L384) · [`settled()`](https://github.com/Laratypes/Laratype/blob/dda9cbd2eb00f17f5feaa60920746a1a1d78d71b/packages/http/src/request/Request.ts#L363-L371) (`@internal`, tests only)

```ts
export type Scope = 'transient' | 'request' | 'singleton';
export interface InjectableOptions { scope?: Scope }   // @Injectable({ scope: 'request' }) is accepted

export class Container {
  // ...the D1 API (see Container), plus:
  scoped<T>(token: Newable<T>): this;                              // = bind(token, undefined, { scope: 'request' })
  scoped<T>(token: Token<T>, concrete: NoInfer<Concrete<T>>): this;
  createRequestScope(options?: ContainerOptions): Container;      // a child container for one request
  dispose(): Promise<void>;                                        // request scopes only
}
```

### Invariants
- **Request scope:** `createRequestScope()` returns a child container that also holds a per-request cache. Like `createChild()`, it sees the parent's bindings and its own bindings shadow them. A child of a request scope shares its cache. A request scope can start another one; the inner one has its own cache, and neither disposes the other's values.
- **Request-scoped keys** are `scoped()` bindings, `bind(..., { scope: 'request' })` bindings, bindings whose class has `@Injectable({ scope: 'request' })`, and unbound classes with `@Injectable({ scope: 'request' })` (autowired; `has()` stays `false`). Each is built once per request scope and cached there until `dispose()`:
  - The **request scope builds it**, so the scope's own bindings apply: `scope.instance(REQUEST_ID, id)` reaches a request-scoped class or factory bound on the app container. A factory receives the request scope.
  - The current request scope is the nearest one up the chain of the container `make()` was called on. A singleton's owner builds it above the request scope, so a request-scoped key it needs resolves in the request scope of the `make()` in progress. Resolution is synchronous, so concurrent requests never mix.
  - With no request scope, resolving a request-scoped key throws (see Diagnostics).
- `transient` and `singleton` keep their lifetimes inside a request scope. A transient that depends on a request-scoped key gets the request's value and needs no bubbling. `instance()` values never bubble.
- **Scope bubbling:** a singleton (a binding, or an autowired `@Injectable({ scope: 'singleton' })` class) that resolves a request-scoped key while it is built, directly or through transients or other singletons, becomes request-scoped for that key:
  - It is not cached as a singleton. Its first value is cached in the current request scope, and from then on it is built once per request scope.
  - It is still built by the container that owns its binding (the root for an autowired class), so a request scope's overrides of its other dependencies don't apply.
  - Outside a request scope it then throws like any request-scoped key.
  - In dev the container prints one `console.warn` per key per process. Copies of `@laratype/core` share the set through `Symbol.for('laratype.di.bubbleWarned')`. It is silent when `globalThis.__PROD__` is `true`, or when `__PROD__` is unset and `NODE_ENV` is `production`: the same check as the http fallback-container warning.
- **`dispose()`** ends a request scope. It drops the cached values and calls `[Symbol.asyncDispose]()` (awaited), or else `[Symbol.dispose]()`, on each one that has it, newest first. A value cached under two keys (a factory that returns another request-scoped value) is disposed once, where it was first built. It runs every disposer, then rethrows the failures as one `AggregateError`.
  - It never disposes a transient, a plain singleton or an `instance()` value; a singleton that bubbled is a request-scoped value, so it is disposed. It doesn't call a dispose method under another name (`dispose()`, `close()`).
  - A second `dispose()` does nothing. Once it has started, `make()` on that request scope, or on a child container of one, throws `Request scope already disposed.` for every key, singletons and transients (and `instance()` values) included: the scope is spent, so nothing resolves through it. A disposed scope can't start a new one with `createRequestScope()`.
- **HTTP:** the middleware of `RequestKernel.boot()` creates one request scope of the app container per request and puts it on the request: `ContextApi.getContainer()` and `RequestKernel.container()` return it, and controllers are resolved from it. It **starts** the scope's `dispose()` when the handler settles: after its response, or after it throws and the app's error handler has built the error response (that handler runs outside the request store). The middleware never awaits it, so a slow disposer does not delay the response and one that never settles does not hang the request. A failed disposal is logged once with `console.error` and never changes the response, and the rejection is handled on the promise that runs it, so it is never an unhandled rejection. Routes served without `RequestKernel` use the autowire-only fallback container, which has no request scope.
  - A request-scoped value may briefly outlive the response. Work started inside the request and not awaited (a `setTimeout`, an unawaited promise) still reads that scope: `ContextApi.getContainer()` and `Request.container()` return it, not the root app container they returned before D6. Once the disposal has started, `make()` on it throws `Request scope already disposed.` for every key, singletons and transients (and `instance()` values) included, so such a call fails instead of resolving from the app container.
  - A streamed body must not use request-scoped values: the disposal may run while the body is still being read.
- `@laratype/core` imports no `node:*` module: the request scope is an object its caller owns. `@laratype/http` keeps it in the AsyncLocalStorage store of `ContextApi`.

### Diagnostics
`DiError` messages (exact text; `[Required by <P>.]` as in [Resolution errors with fix hints](#resolution-errors-with-fix-hints)):
- `Cannot resolve <key>: it is request-scoped but no request scope is active. [Required by <P>.] Fix: resolve it inside a request (from the container of \`createRequestScope()\`), or make it transient.`
- `Request scope already disposed.`
- `Only a request scope can be disposed.` The promise of `dispose()` rejects with it on a container that `createRequestScope()` did not return.

Other messages:
- `AggregateError`: `Failed to dispose <n> request-scoped value(s).`, with the disposers' errors in `errors`, newest value first.
- Dev warning (`console.warn`): `[@laratype/core] <C> is a singleton but depends on request-scoped <D>, so it is resolved once per request. Make <C> request-scoped (or transient) to silence this.` `<D>` is the first request-scoped key reached while `<C>` was built.
- `console.error` from `RequestKernel`: `[@laratype/http] <METHOD> <path>: disposing the request scope failed`, followed by the `AggregateError`. It is logged once the response is resolved: the disposal is not awaited, so it never turns the request into a 500.

Type-only (`container.types.test.ts`, `decorators.test.ts`): `scoped()` rejects what `singleton()` rejects (a wrong concrete type, self-binding an abstract class or a token), and an unknown scope name is a type error. `RequestKernel.settled()` (`@internal`) is typed `() => Promise<void>`.

### Example
[`examples/di/proposed/request-scope.ts`](./examples/di/proposed/request-scope.ts). Tests: [`packages/core/__tests__/requestScope.test.ts`](../../packages/core/__tests__/requestScope.test.ts) and [`packages/http/__tests__/routing/requestScope.test.ts`](../../packages/http/__tests__/routing/requestScope.test.ts) (parallel requests through Hono; the disposal awaits through the kernel's internal `settled()` hook, including a slow, a hung and a failing disposer instead of timing).

### Non-goals
- No async factories or async resolution (as in [Container](#container)).
- No boot-time check for singleton → request dependencies: bubbling handles them when they resolve. Eager validation is [Boot-time graph diagnostics](#boot-time-graph-diagnostics).
- Request-scoped values are disposed once the handler's response is resolved, without delaying it, so a streamed body must not use them: the scope may be disposed while the body is still being read.

### Open questions
- Resolved: autowired classes stay transient, `has()` counts explicit bindings only, and abstract classes get the transform-flag guard ([#112](https://github.com/Laratypes/Laratype/issues/112); see [Container](#container)).

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
- Registries: planned → [#114](https://github.com/Laratypes/Laratype/issues/114) (D7).
- Facades: proposed: PR [#303](https://github.com/Laratypes/Laratype/pull/303) @ b1ca24d (D8 [#115](https://github.com/Laratypes/Laratype/issues/115)). A4 [#151](https://github.com/Laratypes/Laratype/issues/151) then moved the `Auth` accessor onto the guards: it is `AuthService`, and `AuthManager` is the guard manager bound in the app container ([auth.md › Guards in the container](./auth.md#guards-in-the-container)).

### Design (non-binding)
- **D7:** replace `globalThis.__laratype_routes`, `__laratype_route_model_bindings`, `__laratype_param_model_map` and `__laratype_db` with the container bindings `RouteRegistry`, `ModelBindingRegistry` and `DataSource`.

### Public API
[`facade.ts`](https://github.com/Laratypes/Laratype/blob/b1ca24d5334a36cb7ae476161c8a246c8054c314/packages/core/src/facade.ts) · [`container.ts`](https://github.com/Laratypes/Laratype/blob/b1ca24d5334a36cb7ae476161c8a246c8054c314/packages/core/src/container.ts) · [`Hash.ts`](https://github.com/Laratypes/Laratype/blob/b1ca24d5334a36cb7ae476161c8a246c8054c314/packages/support/src/security/Hash.ts) · [`Log.ts`](https://github.com/Laratypes/Laratype/blob/b1ca24d5334a36cb7ae476161c8a246c8054c314/packages/log/src/support/Log.ts) · [`Auth.ts` @ 699f1f8](https://github.com/Laratypes/Laratype/blob/699f1f8f7f91915797880f1ee6f58ccddd3536a1/packages/auth/src/support/Auth.ts) (A4 PR #330)

```ts
// @laratype/core
export interface FacadeClass<T> { readonly accessor: Token<T> }
export abstract class Facade {
  static readonly accessor: Token<object>;                          // set by each facade
  static setFacadeApplication(app: Container | undefined): void;
  static getFacadeApplication(): Container;
  static fake<T>(this: FacadeClass<T>, fake: NoInfer<T>): () => void;
  protected static root<T>(this: FacadeClass<T>): T;
}
export class Container {
  // ...the Container section's API, plus:
  swap<T>(token: Token<T>, value: NoInfer<T>): () => void;
}

// @laratype/support
export class Hasher { make(value: string): string }                 // sha256, as in 0.5
export class Hash extends Facade { static readonly accessor: typeof Hasher; static make(value: string): string }

// @laratype/log
export class LogManager {
  getLogger(): Logger;                                               // the 0.5 winston-backed Logger
  format(): any;
  info(message: any): void;
  error(message: any): void;
  warn(message: any): void;
  debug(message: any): void;
  emergency(message: any): void;
  alert(message: any): void;
  critical(message: any): void;
}
export class Log extends Facade { static readonly accessor: typeof LogManager; /* the same methods, static */ }

// @laratype/auth
export class AuthService {
  attempt<T extends Model>(user: T): Promise<false | Authenticated<T>>;
  user<T extends Model>(): Authenticated<T> | null;
  id<A>(): A;                                                        // throws "Method not implemented." as in 0.5
  isAuthenticated(): boolean;                                        // idem
  check(): boolean;                                                  // idem
  login<T extends Model>(user: T): Authenticated<T>;
  guard<T extends Model>(guardName: string): Authenticate<T>;
  logout(): Promise<void>;                                           // idem
}
export class Auth extends Facade { static readonly accessor: typeof AuthService; /* the same methods, static; attempt() stays an instance method as in 0.5 */ }
```

`AuthService` is stateless: it builds the per-guard handle of a call, and that handle resolves `@laratype/auth`'s `AuthManager` (the guards, bound in the app container by `PassportServiceProvider`, [auth.md › Guards in the container](./auth.md#guards-in-the-container)) from the current request's container. So `Auth.fake()` replaces the 0.5 methods, not the guards.

### Invariants
- A facade's static method resolves `accessor` from the facade application **on every call** and forwards to it. Facades cache nothing, so a binding change or a swap applies to the next call.
- `Hash`, `Log` and `Auth` call `<Facade>.root()`, not `this.root()`, so a detached call (`values.map(Hash.make)`) works as in 0.5.
- The facade application is the container set by `setFacadeApplication()`. `Serve.getContainer()` sets the app container, and `Serve.down()` unsets it when it is still the facade application. Without one, facades share one autowire-only container (`new Container({ deps: depsRegistry })`), which every `setFacadeApplication()` call drops. The state sits on `globalThis` under `Symbol.for('laratype.di.facade')`, so two copies of `@laratype/core` agree.
- The accessors of `Hash`, `Log` and `Auth` are concrete classes holding the 0.5 code, so they autowire when unbound and the 0.5 call sites (`Hash.make()`, `Log.error()`, `Auth.user()`, `Auth.guard()`) behave as before. `LogManager` keeps the 0.5 static logger cache, so the log file transport is created once per process, whatever the container.
- A provider replaces an implementation with `app.bind(Hasher, Impl)` (or `LogManager`, `AuthService`).
- **`app.swap(token, value)`** binds `value` as an instance in that container (its children see it, its parent does not) and returns a restore function. Restore puts back the container's own previous binding, cached singleton included, or removes the binding when there was none. It does nothing when the token was bound again after the swap. Restore functions run in reverse order.
- **`Facade.fake(value)`** is `getFacadeApplication().swap(accessor, value)`, typed by the facade's accessor. A fake lives in the container that was the facade application when it was made: fake after the app container is set.
- A swap changes what the next `make()` returns. A singleton that resolved the token earlier, or while it was swapped, keeps the instance it got.
- `Mail` has no implementation on master (`packages/mail` holds only `package.json`), so its facade comes with ML1 [#170](https://github.com/Laratypes/Laratype/issues/170) on this base.

### Diagnostics
- Resolving an unbound token accessor throws the container's `No binding for InjectionToken(<name>).` ([Container](#container)).
- `DiError`: `Facade <C> has no accessor.` when a facade class does not set `accessor`.
- Type-only (`facade.test-d.ts`): a fake that does not match the accessor type, calling `root()` from outside the facade, a `swap()` value that does not match the token.

### Example
[`examples/di/proposed/facade.ts`](./examples/di/proposed/facade.ts)

### Non-goals
- No `__callStatic`-style proxy: each facade forwards its methods explicitly, so their types (generics included) stay as written.
- No fake classes with assertions (Laravel's `Mail::fake()`): `fake()` takes the fake instance.
- No registries: D7 [#114](https://github.com/Laratypes/Laratype/issues/114).

### Open questions
- The `Mail` facade → [#170](https://github.com/Laratypes/Laratype/issues/170)

### Acceptance
[#114 Done when](https://github.com/Laratypes/Laratype/issues/114) · [#115 Done when](https://github.com/Laratypes/Laratype/issues/115)

---

## Bun build plugin

### Status
proposed: PR #324 @ 6d0af35 (T4 [#116](https://github.com/Laratypes/Laratype/issues/116)).

### Public API
[`sauf/src/di/bun.ts` @ 6d0af35](https://github.com/Laratypes/Laratype/blob/6d0af353ee2f2e85904ae090368aa42c48471b85/packages/sauf/src/di/bun.ts), exported from [`sauf/src/di/index.ts` @ 6d0af35](https://github.com/Laratypes/Laratype/blob/6d0af353ee2f2e85904ae090368aa42c48471b85/packages/sauf/src/di/index.ts) next to the [Vite plugin](#vite-plugin-laratypedi) (internal to the repo: the `sauf` package entry does not export it).

```ts
export interface DiBunPluginOptions extends DiTransformOptions {
  include?: (path: string) => boolean;   // further filter, path with forward slashes; default: every file the checks let through
}
export interface DiBunPlugin {           // the subset of Bun's `BunPlugin` it uses, so sauf builds without bun-types
  name: string;
  setup(build: DiBunPluginBuilder): void;
}
export interface DiBunPluginBuilder {
  onLoad(
    options: { filter: RegExp },
    callback: (args: { path: string }) => Promise<{ contents: string; loader: 'ts' | 'tsx' } | undefined>,
  ): unknown;
}
export function laratypeDiBun(options?: DiBunPluginOptions): DiBunPlugin;   // name: 'laratype:di'
```

### Invariants
- **Same transform:** `onLoad` runs [`transformDi`](#di-transform) on the raw TypeScript, before Bun transpiles it, so the param types are still there. An app file gets the same calls from the [Vite plugin](#vite-plugin-laratypedi) under `sauf dev`. Monorepo `sauf dev` loads the framework packages from `src/`, outside the app root, and does not transform them, so there a framework class with constructor params still needs a binding.
- **Helper import:** `helperId` defaults to `@laratype/core` (`DI_RUNTIME_ID`), imported directly: no `virtual:laratype/di` to resolve, and `@laratype/core` stays an external of the package build. A `helperId` other than `undefined` wins.
- **Which files:** `.ts`, `.tsx`, `.mts` and `.cts`, except `.d.ts` files, `node_modules` and files `include` rejects; those fall through to Bun's own loader. A file with nothing to emit is returned unchanged.
- **`bun.build.js`:** the plugin runs on the ESM and CJS builds of every package that lists `@laratype/core` in `dependencies` (today `@laratype/http`, `@laratype/support`, `@laratype/auth`, `@laratype/log` and `laratype`; `usesDi()` is the check), on that package's own `src/` only. Other packages are built without it, so their `dist/` never imports a package they don't declare. `@laratype/core` is skipped, so it never imports itself.
- **Result:** a framework class with an own constructor carries its metadata in `dist/`. For example `@laratype/http`'s `Request` is registered with `[() => HonoRequest]`, so `container.make(Request)` autowires it from `dist/` once `HonoRequest` is bound; without the plugin it throws `Cannot autowire`.
- **No source maps:** `bun.build.js` emits none, so the plugin returns no map.

### Diagnostics
None of its own: the plugin only reads the source and hands it back. A transform error carries the transform's own `[laratype:di]` message and fails the package build, and resolve-time failures are [Container](#container) `DiError`s. The package builds are minified, so a class in a `DiError` message from `dist/` shows its minified name.

### Example
`packages/sauf/__tests__/di/bun.test.ts`: the plugin hooks, then `container.make(Request)` against the built `@laratype/http` and `@laratype/core` (ESM and CJS) in a plain Node process. Run `bun run build` first.

### Non-goals
- Not the app build: `sauf build` and the test preset share the chain of B2 [#126](https://github.com/Laratypes/Laratype/issues/126).
- Packages that don't depend on `@laratype/core` get no metadata until they do.

### Open questions
- None recorded.

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
- **Shape:** `defineModule({ providers, routes, imports })`, where `providers` lists `ServiceProvider` classes ([ServiceProvider v2 and kernel boot](#serviceprovider-v2-and-kernel-boot)), `routes` lists the module's route wiring ([http.md › Router v2](./http.md#router-v2)): contract routes take their URL from the contract tree and have no prefix, and ad-hoc routes take their path as written ([http.md › Ad-hoc routes](./http.md#ad-hoc-routes)); `imports` lists other modules.
- **Layout:** modules sit in the optional `app/modules/` ([overview.md › Project structure](./overview.md#project-structure)).

### Open questions
- How a module is registered with the kernel → [#153](https://github.com/Laratypes/Laratype/issues/153)
- How a module's contracts fit the `app/api` contract tree and `Route.api` → [#153](https://github.com/Laratypes/Laratype/issues/153)

### Acceptance
[#153 Done when](https://github.com/Laratypes/Laratype/issues/153)
