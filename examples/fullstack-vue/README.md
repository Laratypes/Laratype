# examples/fullstack-vue

A Vue 3 + Vite frontend for the users API of [`examples/basic`](../basic), typed by its contracts through
`@laratype/client` (E4 [#136](https://github.com/Laratypes/Laratype/issues/136)). One page lists users, shows one,
creates one, and renders the declared `404 NOT_FOUND` and `422 VALIDATION_ERROR` by code.

The FE imports **contracts only**: `src/api.ts` imports `examples/basic/app/api/users.ts` and
`examples/basic/app/api/posts.ts`, and builds the `appApi` with `defineApi`. It never imports `$api`, `typeof routes`, a
controller or a model.

## Run it against examples/basic

At the repo root, install and build the workspace packages first (`sauf dev` runs from its `dist`), as
[`examples/basic`'s README](../basic/README.md) explains. That example also needs its MySQL and Google auth
environment:

```
bun install
bun run build && bun run build:type
```

Start the API on <http://localhost:3000> (terminal A):

```
cd examples/basic
bun run dev
```

Generate this example's type overlay and start Vite on <http://localhost:5173> (terminal B):

```
cd examples/fullstack-vue
bun run types
bun run dev
```

Vite proxies `/api` to `http://localhost:3000` (`vite.config.ts`), so the client sends its contract paths to the
basic app. `bun run typecheck` runs the same check as the test below.

`bun run types` scans the same `app/api` tree that `sauf types:generate` reads and writes the `$types.d.ts` overlay into
this example's `.laratype/basic/types` (gitignored). The tsconfig `rootDirs` resolves the contracts' `./$types` imports
there, not in `examples/basic`, so the FE program loads no `examples/basic` file outside `app/api`. The generated `$api`
module is not used: `src/api.ts` builds the same `defineApi` tree from the contract files.

## The type-check test

```
bunx vitest run --project fullstack-vue
```

`__tests__/typecheck.test.ts` spawns `vue-tsc` on this example's own `tsconfig.json` (it never extends the repo
`tsconfig.json`/`tsconfig.app.json`, whose `jsxImportSource: "hono/jsx"` loads hono's types). It proves:

1. the whole FE program, `.vue` files included, type-checks with 0 diagnostics;
2. `--listFilesOnly` lists no `hono`, `typeorm`, `@laratype/http`, `@laratype/support` or `examples/basic` file outside
   `app/api` — the program holds the example's `src`, `@laratype/client` + `@laratype/contract` sources, the contract
   files of `app/api`, zod and the generated `$types.d.ts` overlay;
3. changing a contract field breaks the FE type-check: a temporary copy of the example (under `.laratype/overlay`, the
   real contract file is never edited) renames `UserDto.email` to `emailAddress`, and `vue-tsc` then reports
   `Property 'email' does not exist` in `src/App.vue`.

`bun run test --run` at the repo root runs this project with the rest, which is the CI check of the issue's Done-when.
It needs neither a browser nor the basic app server.
