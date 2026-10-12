---
area: typegen
packages: ["sauf", "@laratype/ts-gen"]
issues: [85, 133, 142, 143, 144]
verified-against: Laratype@d70daa7 (+ 256a743 and v0.5.4 @ 053be38 for the 0.5 state)
last-verified: 2026-10-09
---

# Typegen, skeleton

> **Skeleton.** Every section is planned and no v1 typegen code exists. On master (`256a743`) and on `v0.5.4`, `packages/ts-gen` contains only `package.json`, so there is no 0.5 generator to port. [#133](https://github.com/Laratypes/Laratype/issues/133) records why the earlier oxc AST approach was dropped: oxc has no type checker, so it cannot infer handler return types. Decision record: S2 [#85](https://github.com/Laratypes/Laratype/issues/85), [DECISIONS-S1-S2.md §S2](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s2-85-decision). The prototype generator is `spikes/v1/s2-api/scripts/gen.mjs` on PR #197 @ 4c558fd.

| Section | Status |
|---|---|
| [sauf types:generate](#sauf-typesgenerate) | planned → #133 |
| [Watch mode in sauf dev](#watch-mode-in-sauf-dev) | planned → #142 |
| [OpenAPI](#openapi) | planned → #143 |
| [Detective](#detective) | planned → #144 |

---

## sauf types:generate

### Status
planned → [#133](https://github.com/Laratypes/Laratype/issues/133) (G1, M2). This is also step 4 of `sauf build` ([build.md](./build.md#sauf-build-steps)).

### Design (non-binding)
- **Purpose:** support FEs outside the monorepo (S2 option c). Done when a separate FE project compiles using only the generated files.
- **Canonical output (S2; #133 updated):** one generated `api.ts` that holds:
  - a flattened `AppApi` type alias, the shape of `ApiTypes<AppApi>` ([contract.md › API type projection](./contract.md#api-type-projection));
  - a slim runtime manifest with method, path and declared error codes.

  The file contains no contract lib and no zod. The generator uses **only the TS checker** and never executes contract modules. The spike prints types with `typeToString(NoTruncation)`.
- **Generated types:** they may be `interface` declarations, because the client's `ApiShape<A>` self-constraint accepts them.

### Open questions
- Resolved: the earlier `laratype-api.d.ts` + `rollup-plugin-dts` task is superseded by S2 ([#133](https://github.com/Laratypes/Laratype/issues/133)).

### Acceptance
[#133 Done when](https://github.com/Laratypes/Laratype/issues/133)

---

## Watch mode in sauf dev

### Status
planned → [#142](https://github.com/Laratypes/Laratype/issues/142) (G2, M3).

### Design (non-binding)
`sauf dev` watches `app/contracts/**` and writes incremental output to `.laratype/types/`, so a monorepo FE sees new types without a restart.

### Acceptance
[#142 Done when](https://github.com/Laratypes/Laratype/issues/142)

---

## OpenAPI

### Status
planned → [#143](https://github.com/Laratypes/Laratype/issues/143) (G3, M3).

### Design (non-binding)
- **Generation:** `openapi.json` comes from the route registry (H1 [#104](https://github.com/Laratypes/Laratype/issues/104)), with each schema converted to JSON Schema. Done when it passes `redocly lint`.
- **Exclusions:** ad-hoc routes without a contract are excluded ([#139](https://github.com/Laratypes/Laratype/issues/139)).

### Acceptance
[#143 Done when](https://github.com/Laratypes/Laratype/issues/143)

---

## Detective

### Status
planned → [#144](https://github.com/Laratypes/Laratype/issues/144) (G4, M3).

### Design (non-binding)
- **Data:** the Detective devtools UI consumes `openapi.json` and the route registry, so controller, middleware and schemas are visible.
- **Manifest fix:** #144 reports that `BuildRoute.normalize()` uses `constructor.name` of an array, so the controller shows as `null` in `.laratype/app-manifest.json`, and G4 fixes this. Neither `BuildRoute`, that manifest nor the Detective UI is in this repo on master (`256a743`) or on `v0.5.4`.

### Open questions
- Where the Detective source and `BuildRoute` live → [#144](https://github.com/Laratypes/Laratype/issues/144)

### Acceptance
[#144 Done when](https://github.com/Laratypes/Laratype/issues/144)
