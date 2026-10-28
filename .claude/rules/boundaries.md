---
paths:
  - "packages/contract/**"
  - "packages/client/**"
---

# Browser-pure packages

`@laratype/contract` is shared by the server and the FE, and `@laratype/client` runs in the browser. AGENTS.md › Boundaries has the full rules. In short:

- No `node:*` imports and no Node globals (`process`, `Buffer`, `__dirname`) in `src`.
- No runtime dependencies. Schema libraries (zod, valibot) are devDependencies, used in tests only.
- Contracts depend on the Standard Schema v1 types (`packages/contract/src/standard-schema.ts`), never on one schema library.
- The FE imports contracts only: the `appApi` built with `defineApi`, or a contract file of the `app/api` tree. Never `typeof routes` or a server module.

`packages/contract/__tests__/typecheck.test.ts` compiles `src` with the DOM lib and no Node types, and `packages/client/__tests__/fe.test.ts` compiles the FE fixtures with `types: []` and the DOM lib, from the client outward. Run `bunx vitest run packages/contract` and `bunx vitest run packages/client` after touching these packages.
