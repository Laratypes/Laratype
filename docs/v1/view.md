---
area: view
packages: ["sauf", "@laratype/contract"]
issues: [174, 181, 182]
verified-against: Laratype@256a743
last-verified: 2026-10-10
---

# View

The view layer: serving a Vite frontend, Inertia-compatible typed pages and SSR. It is built in that order: VW1 serves an SPA, VW2 adds the Inertia protocol, VW3 adds SSR.

> **Planned only.** No view code exists on master: 0.5 has no view layer. Every section is `planned → #N` and holds a **Design (non-binding)** note built from the issue bodies. A name in backticks below is the name its issue uses. Its parameters and return type are not specified yet. Public API, Invariants, Diagnostics and Example are left out until code lands ([README](./README.md)).

| Section | Status |
|---|---|
| [Serving a Vite SPA](#serving-a-vite-spa) | planned → #174 |
| [Inertia pages](#inertia-pages) | planned → #181 |
| [SSR](#ssr) | planned → #182 |

---

## Serving a Vite SPA

### Status
planned → [#174](https://github.com/Laratypes/Laratype/issues/174) (VW1, M3). Depends on B4 #128, B2 #126.

### Design (non-binding)
- **`vite()` helper:** in dev it injects the Vite client and HMR. In production it reads `manifest.json` for the asset tags.
- **Static files:** `public/` is served with `serveStatic`, plus an SPA fallback route.
- **Build:** `sauf build` also builds the frontend entry ([build.md › sauf build steps](./build.md#sauf-build-steps)).
- **Reference app:** `examples/fullstack-vue` (E4 [#136](https://github.com/Laratypes/Laratype/issues/136)) is served by the backend in dev and in production.

### Open questions
- The package that holds `vite()` (#174 names none) → [#174](https://github.com/Laratypes/Laratype/issues/174)
- Where `public/` and the frontend entry sit in the project layout ([overview.md › Project structure](./overview.md#project-structure)) → [#174](https://github.com/Laratypes/Laratype/issues/174)

### Acceptance
[#174 Done when](https://github.com/Laratypes/Laratype/issues/174)

---

## Inertia pages

### Status
planned → [#181](https://github.com/Laratypes/Laratype/issues/181) (VW2, M4). Depends on VW1 #174, C5 #93.

### Design (non-binding)
- **Protocol:** the server side of the Inertia protocol: `X-Inertia` responses, the asset version (409), partial reloads and shared props. The official `@inertiajs/vue3`, `@inertiajs/react` and `@inertiajs/svelte` adapters then work unchanged.
- **Contract:** `definePage(name, propsSchema)` in the contract, and a typed `page()` response.
- **FE:** page props are typed on the frontend.

### Open questions
- How a page reaches the FE types: next to `defineApi` / `AppApi` ([contract.md › defineApi and route names](./contract.md#defineapi-and-route-names)) or separately → [#181](https://github.com/Laratypes/Laratype/issues/181)

### Acceptance
[#181 Done when](https://github.com/Laratypes/Laratype/issues/181)

---

## SSR

### Status
planned → [#182](https://github.com/Laratypes/Laratype/issues/182) (VW3, M4). Depends on VW2 #181.

### Design (non-binding)
- **Entry:** a Vite SSR entry, loaded with `ssrLoadModule` in dev and bundled in production.
- **Fallback:** when SSR fails, the page falls back to client-side rendering.
- **Examples** for Vue, React and Svelte.

### Acceptance
[#182 Done when](https://github.com/Laratypes/Laratype/issues/182)
