At the repo root, install and build the workspace packages first (sauf runs from its `dist`):
```
bun install
bun run build && bun run build:type
```

The example uses the v1 project layout (`docs/v1/overview.md` › Project structure): contracts under `app/api/`, controllers, middleware, requests and resources under `app/http/`, models, policies, providers and services under `app/`, routes and config under `app/routes/` and `app/config/`, and factories and seeders under `database/`.

The DB-backed routes (`POST /api/register`, `POST /api/admin/register`, `POST /api/login`, `POST /api/login/manual`, `POST /api/admin/login`, `GET /api/admin/admins/:admin`) connect to MySQL (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`; defaults `localhost:3306`, `root`, no password, database `test`, in `app/config/config.ts`). The Google auth provider reads `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET`. Set them in your environment or an `.env` file in `examples/basic`. The Google guard is skipped when they are missing only in an explicit non-production environment: `sauf dev` (`__PROD__ === false`), or `development`/`test` in `NODE_ENV` or `APP_ENV`. A `production` in either variable wins and builds the guard, and any other value (`local`, `staging`, unset) alone is treated as production and fails the boot until the credentials are set.

`GET /api/users` and `POST /api/users` use the in-memory `UserService` and are **behind the contract's auth capability**: send a bearer token. The 0.5 signup/login routes stay DB-backed, so they need MySQL for a successful sign-in. `/api/users` is a demo store, not a database: it starts empty on each boot and is reachable only by an authenticated caller.

Then start the example:
```
cd examples/basic
bun run dev
```

```
open http://localhost:3000
```

The route surface:

| Method and path | Auth / policy |
|---|---|
| `GET /api/users`, `POST /api/users`, `GET /api/users/:id` | `auth: true` + `UserPolicy` (`index` / `store` / `show`) |
| `GET /api/me` | `auth: true` |
| `POST /api/register`, `POST /api/login`, `POST /api/login/manual`, `GET /api/callback`, `GET /api/google/callback` | public |
| `POST /api/admin/register`, `POST /api/admin/login` | public (under the admin scope, `.public()`) |
| `GET /api/admin/me` | `auth: 'admin'` + `AdminPolicy` |
| `GET /api/admin/admins/:admin` | `auth: 'admin'` + `AdminPolicy`, explicit `r.bind({ admin: ... })` |
| `GET /api/greeting`, `GET /api/posts`, `POST /api/posts` | public |

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

The tests boot the app from sauf's app manifest with every provider of `app/config/providers.ts` (none stubbed), and drive the contracts through `app.request()`, `@laratype/client` and a real socket on port 0. They generate `$types.d.ts` and `$api` first, the same scan `sauf dev` runs. They need neither Google credentials (the Google guard is skipped outside production) nor MySQL: `DatabaseServiceProvider` logs the connection error and lets the boot finish. The authenticated cases swap the app container's `AuthManager` for one whose `TokenGuard` verifies real JWTs against in-memory provider rows (`__tests__/support/auth.ts`); only the provider's user lookup is in memory. A test run writes its log under `examples/basic/storage/logs`, which git ignores.

**Not ported (no v1 API):** the Google callback middleware keeps the 0.5 passport strategy (`app/http/middleware/Middleware.ts`), and the password login controllers call the 0.5-era `Auth.guard(...).attempt(...)`. Both are mounted through the v1 route builder; v1 has no OAuth-login or login middleware API.

**This example is a demo, not a production-hardened app.** Its `Route.api` routes enforce the contract's auth, authorization policies and query/body schemas, but `/api/users` is an in-memory store and the DB routes need MySQL. `PATCH` and `DELETE /api/users/:id` have no v1 endpoints yet. Don't deploy it.
