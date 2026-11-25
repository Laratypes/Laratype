# bench/ — phase-1 runtime benchmark (#353)

Dev-only benchmark of the v1 request path: Laratype v1 against Hono (its own baseline), Express and Fastify. It is a
private workspace; nothing here is published, and no `@laratype/*` package depends on it.

**Phase 1 covers scenarios 1–5 and skips the SQLite read (6) in every app**: there is no v1 database API on master
(DB1 #145 is planned), Node 20.17 has no `node:sqlite`, and `bun:sqlite` is Bun-only. The report says so. NestJS,
AdonisJS, Laravel, the `sauf build` run and the docs results page are phase 2.

## Setup

Node 20.17 (`.node-version`) and Bun (CI pins 1.3.14) are required. From the repo root:

```sh
bun install --ignore-scripts --minimum-release-age=1209600
bun run build
```

`bun run build` builds the workspace `dist` the apps import; the runner also builds it if `packages/http/dist` is
missing (not timed).

## One command

```sh
bun run bench
```

It writes `bench/out/<sha>-<UTC>.json` and `.md` with the machine, runtime/framework versions, commit SHA, settings and
every run. `bench/out/` is gitignored; results are never committed. Smoke only:

```sh
bun run bench:smoke            # every app x runtime, every scenario, exact bodies, one 1 s autocannon run
```

Flags: `--apps`, `--runtimes node,bun`, `--scenario <name>`, `--connections` (50), `--duration` (10 s), `--warmup` (2 s),
`--out <dir>`, `--allow-node-mismatch`. Set `BENCH_NODE` / `BENCH_BUN` (or `--node` / `--bun`) to pick a runtime binary.
On a machine whose `node` is not the `.node-version` binary, `BENCH_ALLOW_NODE_MISMATCH=1` records the actual version
instead of failing; reports always name the Node and Bun versions they ran on.

## Scenarios (same bytes in all four apps)

| # | Route | Request | Response |
|---|---|---|---|
| 1 | `GET /api/json` | — | 200 `{"message":"Hello, World!"}` |
| 2 | `GET /api/users/42` | — | 200 `{"id":"42"}` |
| 3a | `POST /api/users` | `{"name":"Ada","email":"ada@example.com"}` | 201 `{"id":1,"name":"Ada","email":"ada@example.com"}` |
| 3b | `POST /api/users` | `{"name":"","email":"nope"}` | 422 `{"code":"VALIDATION_ERROR","message":"The given data was invalid.","errors":{...}}` |
| 4 | `GET /api/chain` | — | 200 `{"m1":1,"m2":1,"m3":1}` |
| 5 | `GET /api/scoped` (twice) | — | 200 `{"scoped":1}` both times |
| 6 | SQLite read | — | skipped in phase 1 |

All four use the same Zod 4.6.7 schema for 3a/3b. The 422 envelope is built from the same Zod issues by
`shared/validation-error.mjs` (a copy of the framework's `publicIssue` mapper), so 3b is byte-identical too. `GET
/health` is readiness only and never measured.

## Method and fairness

- One server process at a time, spawned per scenario on a free port bound to `127.0.0.1`; health-checked, warmed up,
  measured, killed and awaited before the next run. No cluster, no parallel servers.
- The bench pins its own `@hono/node-server` 2.1.6 (patched for GHSA-rmxm-3fg6-px4f); the root workspace's and
  `sauf`'s older entries are pre-existing and untouched.
- Metrics: req/s, p50/p99 latency, cold start (spawn → first 200 on `/health`), RSS at idle and under load (from the
  child pid: `/proc/<pid>/status` on Linux, `tasklist` on Windows, `ps` on macOS). A failed run is recorded and the
  suite continues; it exits 1 at the end.
- 50 connections, 10 s measured, 2 s warm-up discarded, pipelining 1, keep-alive on, no extra Node flags. Autocannon
  always runs on Node, never on the Bun under test.
- `NODE_ENV=production` everywhere; no logging (Fastify `logger: false`, Express `x-powered-by` off, Hono/Laratype log
  nothing). Express keeps its default `etag`; no compression, no TLS, HTTP/1.1.
- On Bun, Hono/Laratype use `Bun.serve`; Express/Fastify use `app.listen`/`fastify.listen` through Bun's node:http
  compatibility, their only Bun path. This caveat is in every report.

## The Laratype entry is hand-written, not `sauf build`

`apps/laratype/entry.mjs` boots a v1 app directly: `Container` → `HTTP_APP` → `RequestKernel`/`ResponseKernel` →
`Route.api(...).mount(app)`, over `@hono/node-server` on Node and `Bun.serve` on Bun. **It is not a `sauf build` output**
(B4 #128 / B6 #130 are unmerged) and not `examples/basic` (0.5 layout; E3 #135 is unmerged). The app writes the DI
metadata the build transform would emit by hand (`__laratype_deps`, one request-scoped controller), uses the D6 request
scope (`container.scoped`) only on `/api/scoped`, and skips the SQLite scenario.

The only framework override is `BenchRequestKernel.resolveRequest() {}`: the stock method prints one
`console.log(method - url)` per request (`packages/http/src/request/Request.ts:599-600`), which would break the logging
rule and dominate the measurement. No other kernel method is overridden. A framework opt-out is a follow-up issue.

## Adding a scenario or framework

Add the route to every app, add its exact response bytes to `scenarios.mjs`, and (only if it is a new framework) a
folder under `apps/` plus the `APPS` list in `run.mjs`. Keep the body/status comparison exact; the smoke is the check.
