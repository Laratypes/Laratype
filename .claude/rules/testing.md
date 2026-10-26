---
paths:
  - "packages/*/__tests__/**"
---

# Tests

## Files

- Runtime tests: `*.test.ts`. Type tests: `*.test-d.ts`. Only `*.test-d.ts` files run in the `types` project (`vitest.typecheck.config.ts`), so new type tests use that suffix. `packages/core/__tests__/container.types.test.ts` is an older exception.
- Fixtures go in `__tests__/fixtures/`.
- v1 tests import from the public entry (`@laratype/contract`, `@laratype/core`), so they test what users get. 0.5 tests may import `../src/...` internals.

## Structure

- `describe` names the unit under test (`describe("defineError", ...)`). `it` is a present-tense sentence about one behaviour (`it("returns a frozen factory carrying status and code", ...)`).
- Add a short comment before a non-obvious assertion, as `packages/contract/__tests__/errors.test.ts` does.
- In type tests, wrap calls that must not run in a `typeOnly(() => { ... })` helper (`packages/core/__tests__/container.types.test.ts`), and give every `@ts-expect-error` a reason.

## What to test

- New public API gets a runtime test and a type test.
- Snapshot tests run with `CI=true` (`CI=true bun run test:di`), so a missing snapshot fails instead of being written.
- Before the full suite, run `bun run build`: some tests run the built sauf CLI or resolve `@laratype/core` from `dist`.
