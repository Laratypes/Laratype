At the repo root, install and build the workspace packages first (sauf runs from its `dist`):
```
bun install
bun run build && bun run build:type
```

The example connects to MySQL on start (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`; defaults `localhost:3306`, `root`, no password, database `test`, in `app/config/config.ts`), and its Google auth provider reads `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET`. Set them in your environment or an `.env` file in `examples/basic`.

Then start the example:
```
cd examples/basic
bun run dev
```

```
open http://localhost:3000
```

The production build (`bun run build`) is planned → [#125](https://github.com/Laratypes/Laratype/issues/125): the contract routes import `$api`, which only `sauf dev` resolves until the build manifest lands.
