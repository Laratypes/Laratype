---
paths:
  - "packages/**/*.ts"
  - "scripts/**"
  - "examples/**"
---

# Code style

## Formatting

- The target style is the B22 decision in `biome.json`: double quotes, semicolons, 2-space indent, LF, line width 120.
- The Biome formatter stays off until the repo-wide format (B22 #277, PR 2). Until then:
  - New files use the target style.
  - Edited files keep the style they already have (`packages/core` and most v1 tests use single quotes and no semicolons). Don't reformat lines you don't change.
- After the repo-wide format lands, Biome is the authority and this section shrinks to "run Biome".

## Lint

- `bun run check:lint` must pass. It reports errors only, and CI runs it.
- Don't apply Biome fixes (`biome lint --write`, editor fix-all) for rules set to `fix: none`. Their fixes break the build: the `useImportType` fix turns constructor-injected imports into `import type`, and other fixes broke the type-check (commit 7541517).

## Imports and exports

- Type-only imports use `import type`.
- A class injected through a constructor stays a value import, even if it is used only as a type. The sauf DI transform reads it at runtime.
- Node built-ins use the `node:` protocol (`node:path`, `node:vm`).
- v1 packages (`contract`, `core`, `client`) use named exports only: no `export default` in their `src`. Default exports belong to user contract files (`export default defineContract<Prefix>()(...)`).
- 0.5 packages keep their default exports: they are the public API of the published 0.5 packages. Change them only as part of the package's migration issue.

## TypeScript

- Public types need TypeScript >= 5.4. Use `NoInfer` where a parameter must not widen inference (see `packages/contract/src/endpoint.ts`).
- Type values as `unknown`, not `any`. Use `any` only in type-level positions where inference needs it, e.g. `E extends ErrorDef<any, infer Code, any, any>` in `packages/contract/src/errors.ts`.
- Non-null assertions (`!`) are allowed, but only when the value is checked a few lines above.
- Never use `@ts-ignore`. Use `@ts-expect-error` with the reason on the same line: `// @ts-expect-error a required param cannot be omitted`. The few `@ts-ignore` left in 0.5 code (`auth`, `sauf`) predate this rule: replace one when you edit its line.

## Idioms

- `const` unless the variable is reassigned. `===` and `!==`.
- Template literals instead of string concatenation, optional chaining instead of `a && a.b`.
- `Array.isArray`, not `instanceof Array`. No `obj.hasOwnProperty(...)` calls.
