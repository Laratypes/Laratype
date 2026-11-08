At the repo root, install and build the workspace packages first (sauf runs from its `dist`):
```
bun install
bun run build && bun run build:type
```

The example connects to MySQL on start (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`; defaults `localhost:3306`, `root`, no password, database `test`, in `app/config/config.ts`), and its Google auth provider reads `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET`. Set them in your environment or an `.env` file in `examples/basic`. The Google guard is skipped when they are missing only in an explicit non-production environment (`sauf dev`, or `NODE_ENV`/`APP_ENV` = `development`/`test`); an unset environment is treated as production and fails the boot until they are set.

Then start the example:
```
cd examples/basic
bun run dev
```

```
open http://localhost:3000
```

Production build and start:
```
cd examples/basic
bun run build          # sauf types:generate && tsc -b ./tsconfig.build.json && sauf build
bun run start          # node ./dist/index.js
bun run saufx -- route:list   # the sauf CLI of the build (node ./dist/cli.js)
```

Tests, at the repo root (`bun run test --run` runs them with the rest):
```
bunx vitest run --project examples
```

The tests boot the app from sauf's app manifest with every provider of `app/config/providers.ts` (none stubbed), and
drive `/api/users` through `app.request()`, `@laratype/client` and a real socket on port 0. They generate `$types.d.ts`
and `$api` first, the same scan `sauf dev` runs. They need neither Google credentials (the Google guard is skipped
outside production) nor MySQL: `DatabaseServiceProvider` logs the connection error and lets the boot finish. A test
run writes its log under `examples/basic/storage/logs`, which git ignores.

**This example is a demo, not a production-hardened app.** Its `Route.api` routes are fail-open: auth, authorization policies and headers schemas declared in the contracts are not enforced yet (planned → [#105](https://github.com/Laratypes/Laratype/issues/105), [#121](https://github.com/Laratypes/Laratype/issues/121); query and body schemas are validated, [#106](https://github.com/Laratypes/Laratype/issues/106)), so `POST /api/posts` and `POST /api/users` answer every caller. In the built app, controllers with constructor dependencies (`GreetingController`) can't be resolved yet, because the production build doesn't run the DI transform (planned → [#126](https://github.com/Laratypes/Laratype/issues/126), [#128](https://github.com/Laratypes/Laratype/issues/128)). Don't deploy it.
