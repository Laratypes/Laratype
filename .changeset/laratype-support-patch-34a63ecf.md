---
"@laratype/support": patch
---

List .env files with fs.readdirSync instead of glob, and bump @hono/node-server to ^2.1.7 across the workspace, including the `@laratype/sauf` Node adapter (a major of the adapter: 1.x to 2.x, Node >= 20; clears the static-file and path-traversal advisories)
