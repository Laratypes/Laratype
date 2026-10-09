# Laratype v1 spec (internal)

Internal API spec for Laratype v1, written for contributors and AI agents. User docs live at [laratype.dev](https://laratype.dev).

**Issues are the source of truth for tasks and Done-when; `docs/v1/<area>.md` is the source of truth for the API.**

One file per area (`contract.md`, `di.md`, ...). The v1 issues link to the sections that describe their API. Tracking: #83.

## File format

Each file starts with frontmatter:

```yaml
---
area: contract
packages: ["@laratype/contract"]
issues: [89, 90, 91, 92, 93]
verified-against: Laratype@d70daa7 (+ PR heads listed per section)
last-verified: 2026-10-09
---
```

Each section uses these headings, in this order:

1. **Status**, one of:
   - `merged @ <sha>`
   - `proposed: PR #N @ <head sha>`
   - `planned → #N`. A planned section contains no invented signatures. It may carry a short **Design (non-binding)** note; never cite the plan.
2. **Public API**: TypeScript signatures, permalinked to the SHA in Status.
3. **Invariants**
4. **Diagnostics**: the exact runtime error and TypeScript error strings.
5. **Example**
6. **Non-goals**
7. **Open questions**: issue links only. The spec never answers them itself.
8. **Acceptance**: a link to the issue's Done-when, never a copy of it.

## Examples

- `docs/v1/examples/<area>/*.ts` holds examples whose imports all exist on `master`. They are type-checked by `docs/v1/examples/typecheck.test.ts` (added by DOC2 #207).
- Examples for proposed APIs go in `docs/v1/examples/<area>/proposed/*.ts`. The test skips them; check them with `tsc` against the PR's worktree. When the PR merges, move them up one level and update the section's Status.

## Keeping it current

- A PR that changes a public API updates its spec section in the same PR.
- When a proposed PR merges, re-verify its signatures against `master` and change the Status to `merged @ <sha>`.
- If the code and the spec disagree, the spec is wrong or the code has a bug. Open an issue; don't silently edit either side.
