---
paths:
  - "packages/**/src/**"
---

# Errors and comments

## Errors

- Each package throws its own `Error` subclass and sets its `name`: `ContractError` (`packages/contract/src/errors.ts`), `DiError` (`packages/core/src/container.ts`).
- Build message text in one place per package and reuse it: the `errors` builders in `packages/core/src/container.ts`, `fail()` in `packages/contract/src/internal.ts`.
- A message is a full sentence that names the offending value (`got ${JSON.stringify(path)}`). When the fix isn't obvious, add it after `Fix:`, as the `DiError` messages do.
- To recognize an error that may come from another bundle or package copy, check a `Symbol.for` brand, not `instanceof` (`CONTRACT_ERROR` in `packages/contract/src/errors.ts`).

## Comments

- Every public export gets a `/** */` JSDoc of one or two sentences: what it is, and the constraint a caller must know.
- Inline `//` comments say why the code does something, not what it does.
- Reference the spec as `<file>.md › <section>` (`client.md › Result union`) and issues as `<ID> #<N>` (`C6 #94`).
- No commented-out code. No `TODO` without an issue number.
