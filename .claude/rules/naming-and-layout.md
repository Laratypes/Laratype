---
paths:
  - "packages/**"
---

# Naming and file layout

## Files

- **v1 packages** (`contract`, `core`, `client`): one lowercase file per concept, kebab-case when it has several words (`standard-schema.ts`, `api-types.ts`).
  - `src/index.ts` re-exports the public API, in one of two forms: `export * from "./<file>"` (`contract`), or explicit name lists with `export type { ... }` for the types (`core`, `client`). Keep the form the package already uses.
  - Helpers that several files of the package share and that are not public go in a module `index.ts` does not re-export: `contract/src/internal.ts`. A helper used by one file stays in that file (`core` keeps its `errors` builders in `container.ts`).
- **0.5 packages** (`http`, `support`, `auth`, `database`, ...): one PascalCase file per class, in a folder per concern (`http/src/response/Response.ts`, `support/src/exception/NotFoundException.ts`). Keep that layout when you edit 0.5 code. Rename or move files only as part of a migration issue.

## Names

| What | Style | Examples |
|---|---|---|
| Classes, interfaces, type aliases | PascalCase | `ContractError`, `InjectionToken`, `ErrorBody` |
| Functions, methods, variables | camelCase | `token()`, `isFailureStatus()` |
| Public builders | `define*` | `defineError`, `defineContract`, `defineScope`, `defineApi` |
| Module-level constants | UPPER_SNAKE | `CONTRACT_ERROR`, `PACKAGE_NAME` |
| Error codes | UPPER_SNAKE (`defineError` rejects anything else) | `EMAIL_TAKEN`, `TEAPOT` |
| Generic parameters | `T` when there is one; short PascalCase words when there are several | `<St, Code, Body>`, not `<T1, T2, T3>` |
