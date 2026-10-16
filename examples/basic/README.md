```
pnpm install
pnpm run dev
```

```
open http://localhost:3000
```

The production build (`bun run build`) is planned → [#125](https://github.com/Laratypes/Laratype/issues/125): the contract routes import `$api`, which only `sauf dev` resolves until the build manifest lands.
