At the repo root, install and build the workspace packages first (sauf runs from its `dist`):
```
bun install
bun run build && bun run build:type
```

Then start the example:
```
cd examples/basic
bun run dev
```

```
open http://localhost:3000
```
