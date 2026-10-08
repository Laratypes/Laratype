# S3 spike: constructor DI metadata transform (oxc before SWC), findings

Issue: #86 · Feeds: T1 #101, T2 #102, T3 #103, D2 #97, D3 #98

## Verdict: GO, with 3 conditions

The oxc pre-transform works. Every edge case in the issue was run through the real pipeline (transform → `@swc/core` with the exact `warmup.ts` options → Node ESM), and all of them behave as specified. The same fixtures also pass under Vite `ssrLoadModule`, the `sauf dev` path. Cost is negligible with a `constructor` pre-check: about 0.3 ms warm for all 43 files in `examples/basic/app`, which is 3% of SWC.

Conditions:
1. **Require `verbatimModuleSyntax: true`** in app tsconfigs and check it in `sauf build`'s typecheck step. An interface imported without `type` fails in a different way in each environment (see the table below). TS1484 is the only place that catches it consistently, and it catches it early.
2. **Turn off SWC `decoratorMetadata`** in the sauf SWC config once T1 lands. It keeps type-only imports alive *independently of our transform*, so `@Inject(TOKEN) m: Mailer` with `import { Mailer }` still breaks Node ESM. The registry replaces `design:paramtypes`. The v0 code reads only custom metadata keys (`MetaDataKey.*`), never `design:*`. Third-party classes come precompiled, so the D2 fallback is unaffected.
3. **Keep the runtime diagnostics** (unresolved marker, thunk returned `undefined`, decorator/thunk conflict). In `sauf dev` they are the only signal.

## What was built (`spikes/v1/s3-di`)

| Path | What |
|---|---|
| `src/transform.ts` | Pure `transform(code, id, opts) → { code, map } \| null`, using `oxc-parser` 0.102 + `magic-string`. Includes scope tracking (module/function/block scopes, class type params). |
| `src/runtime.ts` | Spike version of `virtual:laratype/di`: WeakMap registry, `getDeps` (own entry, else parent walk), `@Inject` / `@Injectable`, a minimal container with the diagnostics. |
| `fixtures/<case>/` | One directory per edge case. `main.ts` asserts behaviour at runtime. |
| `scripts/run.ts` | transform → SWC (`warmup.ts` options) → `out/` → `node out/<case>/main.js`, one process per case. Also checks SWC statement order and runs `tsc --noEmit` (TS1484). |
| `scripts/vite-check.ts` | Same fixtures through Vite 7 `ssrLoadModule` (dev), plus `vite build` (Rollup) for prod behaviour. |
| `scripts/bench.ts` | Perf over `examples/basic/app`. |

Run it with Node ≥ 22.18 (type stripping), from `spikes/v1/s3-di`. The deps come from the `spikes/v1/node_modules` junction:
```
node scripts/run.ts                 # 16 cases + 2 SWC-order checks + tsc check
node scripts/vite-check.ts          # VITE_PATH=… to override the vite location
node scripts/bench.ts 30 [--always-parse]
```
`TSC_BIN` overrides the tsc path (the default is the main checkout's `node_modules/typescript`).

Result of `run.ts`: **all checks passed** (12 behaviour cases, 4 expected-failure cases, 2 statement-order checks, 1 tsc check).

## Emitted shape

```ts
import { __laratype_deps } from "virtual:laratype/di";
// …
export class Notifier {
  constructor(@Inject(MAILER) private mailer: Mailer, public name: string, public clock: Clock = new Clock()) {}
}
__laratype_deps(Notifier, [() => MAILER, { unresolved: "string", index: 1 }, () => Clock],
  { params: ["mailer", "name", "clock"], optional: [2] });
```

- **One slot per param, never skipped**, so indices always match the real constructor. A slot is one of:
  - `() => Dep` for a value binding
  - `() => TOKEN` for `@Inject(TOKEN)`: the token is resolved in the transform, so the registry is the source of truth
  - `{ unresolved, index }` for everything without a runtime value
- `meta.params` holds the parameter names, used for diagnostics. `meta.optional` lists the indices of `?` and default-valued params.
- Only classes with an **own constructor implementation** emit. No own constructor means no entry, and the runtime walks the parent. An explicit `constructor() {}` emits `[]`.
- The statement is placed **after the class**, so under SWC legacy decorators it runs after `X = _ts_decorate([...], X)` and registers the **final** binding. Verified in the SWC output (`Svc`, `Swapped`, and the anonymous default class). A decorator that replaces the class (`@Replace` returning `class Replaced extends target`) gets its own entry.

### Runtime diagnostics (spike runtime, for D2/D5a)
```
DiError: Cannot resolve Mixed constructor param #1 `name`: type `string` has no runtime value.
  Fix: add @Inject(token) to the parameter, or import the class as a value (not `import type`).
DiError: Cannot resolve Notifier constructor param #0 `mailer`: its type resolved to undefined at runtime.
  It is probably an interface/type imported without `import type`, or a circular import evaluated too early.
  Fix: use `import type` + @Inject(token), or import the class as a value.
DiError: Conflicting metadata for UsesWrapperOnClass constructor param #0 `logger`: transform says ConsoleLogger,
  @Inject says Symbol(Logger). Fix: use @Inject from @laratype directly (aliases/wrappers are invisible to the build transform).
DiError: Circular dependency: D -> E -> D
```

## Interface imported without `type`: same source, different behaviour per environment

Source: `import { Mailer } from './types.js'` where `Mailer` is an interface, used as `constructor(m: Mailer)`.

| Environment | Result (observed) |
|---|---|
| `tsc --noEmit` with `verbatimModuleSyntax` | `error TS1484: 'Mailer' is a type and must be imported using a type-only import…` |
| transform → SWC → **Node ESM** | `SyntaxError: The requested module './types.js' does not provide an export named 'Mailer'` (link error, module never runs) |
| transform → SWC → **Vite `ssrLoadModule`** (`sauf dev`) | **No link error.** The thunk returns `undefined`, so you get `DiError … resolved to undefined at runtime` at resolve time |
| **`vite build`** (Rollup) | Build error: `"Mailer" is not exported by "…/types.ts", imported by "…/main.ts"` |
| `importStrategy: 'namespace'` (Node ESM / Vite dev) | No link error. The thunk returns `undefined`, so `DiError … resolved to undefined` |
| `importStrategy: 'namespace'` (`vite build`) | Builds without error. Rollup folds the thunk to `()=>undefined`, so the error moves to runtime |

**SWC `decoratorMetadata` keeps the import alive on its own.** In `metadata-keeps-import`, the class is `@Injectable()` and the param is `@Inject(MAILER) m: Mailer`. Our transform references only `MAILER`, but SWC emits `design:paramtypes = [typeof Mailer === "undefined" ? Object : Mailer]`, which keeps `import { Mailer }`. The result is the same Node ESM link error. With `decoratorMetadata: false` the case passes (`metadata-keeps-import+no-metadata`). Under Vite dev the metadata variant happens to pass, because SSR imports are property reads.

**Namespace-import mitigation** (`import * as __di_ns0 from './x'`, `() => __di_ns0["Foo"]`, implemented as an option):
- Removes the link error in every environment.
- Cost in the prod bundle: none for the happy path. `vite build` of `param-properties` is 4967 B in both modes, and Rollup inlines the binding with no namespace object materialised. Node ESM and Vite SSR already create a namespace object per module, so the extra cost should be negligible (not measured).
- Downside: it hides the Rollup build error (it becomes a runtime `DiError`), and it adds a real import edge to modules that would otherwise be elided (type-only modules get evaluated).
- **Recommendation:** default to `direct` + `verbatimModuleSyntax`, and don't ship `namespace` unless T1 finds a case that `verbatimModuleSyntax` can't cover.

## Edge cases (case → behaviour → owner)

Owner: **T1** = transform (#101), **T3** = snapshot/runtime tests (#103). D2/D3 are noted where the runtime is involved.

| # | Case | Spike behaviour (verified) | Owner |
|---|---|---|---|
| 1 | Parameter properties (`private readonly x: Foo`, `public`) | Unwrap `TSParameterProperty` to get the type → `() => Foo` | T1, T3 |
| 2 | Explicit zero-arg `constructor() {}` | Emits `[]` | T1, T3 |
| 3 | No own constructor (`class B extends A {}`) | No emit; runtime walks to parent (2 levels tested); abstract parent works | T1, T3, D2 |
| 4 | Child with own constructor | Own entry only; parent deps are not used | T1, T3, D2 |
| 5 | `constructor(...args) { super(...args) }` | Treated as "no own constructor" (heuristic: first param is rest) → inherits parent | T1 (confirm heuristic), T3 |
| 6 | Trailing rest `constructor(a: A, ...rest)` | Rest gets no slot; params before it are emitted normally | T1 |
| 7 | `@Inject(TOKEN)` param | Slot `() => TOKEN`; the type is ignored, so `import type` + interface is fine | T1, T3, D3 |
| 8 | Aliased `import { Inject as Use }` | Detected through the import binding (`importedName === 'Inject'`) | T1 |
| 9 | Wrapper decorator (`const InjectLogger = () => Inject(LOGGER)`) | Invisible to the transform. On an interface: marker + runtime `@Inject` record → token used. On a class type: **thunk and decorator disagree** → `DiError Conflicting metadata`. The decorator must keep a runtime record for this check | D3, T3 |
| 10 | `import type { X }` / `import { type X }` | `{ unresolved: "X" }` | T1, T3 |
| 11 | Local `interface` / `type` alias | `{ unresolved }` (declaration merging: a class of the same name wins) | T1, T3 |
| 12 | Primitives (`string`, `number`…) | `{ unresolved }`; container throws with class, index, name and fix hint, unless `@Inject` is present | T1, T3, D5a |
| 13 | Optional `x?: T` / default `x = …` | Listed in `meta.optional`. Class type → injected (the default is **ignored**). Unresolvable → `undefined`, so the default applies | T1, D2 |
| 14 | `Foo \| undefined` / `Foo \| null` | Stripped to `() => Foo`; **not** marked optional yet | T1 (decide: mark optional) |
| 15 | Other unions (`Foo \| string`), arrays, function types, literals, `typeof x` | `{ unresolved: "<type text>" }` | T1 |
| 16 | Generics `Repo<User>` | `() => Repo`. `Repo<User>` and `Repo<Post>` **collide** on one token (same as TS `design:paramtypes`); needs `@Inject` to separate | T1 (maybe warn), T3, docs |
| 17 | Class type param `class Box<Dep> { constructor(d: Dep) }` | Type param shadows the module-level `Dep` → `{ unresolved: "Dep" }` | T1, T3 |
| 18 | Class nested in a function | Scope tracking sees function-local + module bindings | T1, T3 |
| 19 | Globals (`Date`, `Map<…>`, `Promise`, `Record`) | **Currently `{ unresolved }`** (no local binding). Decide: keep unresolved, or emit a guarded thunk `() => typeof X === "undefined" ? undefined : X` | **T1 decision** |
| 20 | Local `enum` | `{ unresolved }` (it has a value but isn't injectable). An imported enum can't be detected and becomes a thunk to a non-class | T1 |
| 21 | Qualified `ns.Foo` | Thunk if the root `ns` is a value binding (`import * as ns`, TS namespace); otherwise unresolved | T1 |
| 22 | `export default class Named` | Statement after the class (`__laratype_deps(Named, …)`) | T1, T3 |
| 23 | **Anonymous `export default class {}`** | Gets a generated name: `export default class __laratype_default {…}` + `__laratype_deps(__laratype_default, …)`. **`.name` changes from `"default"` to `"__laratype_default"`.** Works with `@Injectable()` (SWC reassigns `__laratype_default = _ts_decorate(…)` and the live default export follows) | T1 (naming), T3 |
| 24 | `const X = class {}` | Statement after the declaration; `X.name === "X"` is kept | T1, T3 |
| 25 | Other class expressions (call argument, `X = class {}`, object property) | Wrapped: `__laratype_deps(class {…}, …)`. **Name inference is lost**: `.name === ""`. That's harmless for call arguments (already `""`) but changes `X = class {}` and `{ Foo: class {} }` | T1 (handle `AssignmentExpression` / `Property` like declarators) |
| 26 | Class decorator `@Injectable()` | `__laratype_deps` comes after `X = _ts_decorate(…)` in the SWC output, so it registers the final binding | T1, T3 |
| 27 | Class decorator that replaces the class | The replacement gets its own entry (verified: `Swapped.name === "Replaced"`, `hasOwnDeps` true) | T3 |
| 28 | Circular module imports (`a.ts ⇄ b.ts`) | Lazy thunks, so no TDZ at module evaluation; graph resolves. A real instance cycle gives `Circular dependency: D -> E -> D` | T3, D5a |
| 29 | Interface imported without `type` | See the environment table: link error / `undefined` / build error. `tsc` catches it with TS1484 | T1 docs, T3, `sauf build` typecheck |
| 30 | SWC `decoratorMetadata` + type-only import | Keeps the import alive regardless of our transform, giving the same link error | T2 (turn off in sauf SWC config) |
| 31 | Constructor overloads | Uses the implementation (the one with a body); `declare class` is skipped | T1 |
| 32 | Non-ASCII source | oxc 0.102 JS spans are UTF-16 offsets (checked in a one-off probe: class `end === code.length` with non-ASCII comments), so magic-string offsets are correct; add a fixture | T1, T3 |
| 33 | Syntax errors | Transform returns `null` and lets SWC report | T1 |
| 34 | `var` hoisted out of nested blocks, `export =`, TSX | Not covered: scope collection is shallow per block | T1 |

## Performance (`examples/basic/app`, 43 `.ts` files, 26.6 KiB)

Windows 11, Node 22.18.0, oxc-parser 0.102.0, @swc/core 1.13.5, magic-string 0.30.21. 3 runs × 30 warm passes; the ranges below are across runs. Cold = first pass in a fresh process.

| | DI transform: total (ms/file) | SWC: total (ms/file) | DI + SWC (warm) |
|---|---|---|---|
| **Default (`constructor` pre-check)**, cold | 3.1–5.1 ms (0.07–0.12) | 12.9–15.1 ms (0.30–0.35) | n/a |
| **Default**, warm | **0.29–0.36 ms (0.007–0.008)**, about **3% of SWC** | 9.8–10.7 ms (0.23–0.25) | 10.5–11.2 ms |
| **Always parse** (upper bound), cold | 10.6–11.8 ms (0.25–0.27) | 14.0–15.6 ms (0.33–0.36) | n/a |
| **Always parse**, warm | **3.9–4.1 ms (0.091–0.096)**, about **37% of SWC** | 10.5–11.3 ms (0.24–0.26) | 18.0–19.0 ms |

- One-time module load: transform + oxc-parser 25–37 ms; `@swc/core` 11–24 ms.
- Only 1 of 43 files contains `constructor`, because v0 controllers don't use constructor DI. The "always parse" row is the realistic upper bound for a v1 app where most files have constructors.
- The pre-check `code.includes('constructor')` is sufficient and safe, since only classes with an own constructor emit. T1 should use it rather than `class`.
- Slowest single files (always parse, warm): `UserController.ts` 1.9 KB, about 0.17–0.20 ms.
- Not measured: oxc-parser raw transfer / lazy deserialization. In the JS API, converting the AST into JS objects is likely the main parse cost, so it's the first thing to try if T1 needs more speed.

## Notes for T1 / T2 / T3 / D2 / D3

- **T1:**
  - The spike's `transform.ts` can be lifted almost as-is.
  - Add `AssignmentExpression` / `Property` placement (#25) and decide #14 and #19.
  - Read the helper id from `virtual:laratype/di` (done).
  - Source maps come from `magic-string` (`hires: 'boundary'`); mapping accuracy is not verified.
- **T2:**
  - Plugin order in `vite-check.ts` (`enforce: 'pre'` DI, then SWC) works under Vite 7 `ssrLoadModule`.
  - Set `decoratorMetadata: false` (#30).
- **T3:** The fixtures and `run.ts` here map 1:1 onto the requested snapshot + runtime tests. Add snapshots of `out/<case>/*.transformed.ts`.
- **D2:** WeakMap + walk to parent only when there's no own entry. With the transform, a child with its own constructor always has its own entry. For untransformed (third-party) classes, check own `design:paramtypes` before walking the parent, because "no entry" doesn't mean "no own constructor" there.
- **D3:** `@Inject` must still record `(class, index) → token` at runtime. It's used for unresolved markers and for detecting conflicts with wrappers/aliases (#9). The registry stays the source of truth for transform-visible `@Inject`.

---

## Draft comment for #86 (not posted, needs user approval)

> **S3 result: GO** (with 3 conditions)
>
> The prototype is in `spikes/v1/s3-di`: an oxc-parser + magic-string pre-transform, run through SWC with the exact `warmup.ts` options and then executed under Node ESM. The same fixtures also pass through Vite 7 `ssrLoadModule`. All edge cases from the issue pass: parameter properties, `@Inject(token)`, `import type`, local interfaces/aliases, primitives, generics, default params, `export default class`, anonymous default class, own vs inherited constructor, circular module imports, plus class decorators, class expressions, nested classes and type-param shadowing.
>
> **Emitted:** `__laratype_deps(Cls, [() => Dep | () => TOKEN | { unresolved, index }], { params, optional })`, placed after the class. Params are never skipped. The call runs after SWC's `X = _ts_decorate(...)`, so it registers the final class. An anonymous `export default class {}` gets a generated name (`__laratype_default`); its `.name` changes from `"default"`.
>
> **Conditions:**
> 1. Require `verbatimModuleSyntax` (TS1484). An interface imported without `type` fails differently per environment: Node ESM link error, `vite build` "is not exported", and in `sauf dev` no error at all until resolve, when the thunk returns `undefined`.
> 2. Turn off SWC `decoratorMetadata`: it keeps type-only imports alive on its own (link error even with `@Inject`).
> 3. Keep the runtime diagnostics. They name the class, param index/name, and give a fix hint.
>
> **Perf** (examples/basic/app, 43 files): with a `constructor` pre-check, 0.3 ms warm in total, about 3% of SWC. With every file parsed (upper bound), 4 ms warm (0.09 ms/file, about 37% of SWC) and 11 ms cold.
>
> The edge-case table (34 cases → behaviour → owner T1/T3) is in `spikes/v1/s3-di/FINDINGS.md`. Open decisions for T1: globals (`Date`/`Map`) unresolved vs guarded thunk; whether `Foo | undefined` should be marked optional; placement for `X = class {}`.
