# bench/ — phase-1 runtime benchmark (#353)

Dev-only benchmark of the v1 request path: Laratype v1 against Hono (its own baseline), Express and Fastify. It is a
private workspace; nothing here is published, and no `@laratype/*` package depends on it.

> **Do not run this on a developer machine.** It starts real app servers and an autocannon load generator, which has
> frozen a local Windows machine. Run it in Docker locally, or in the `bench` GitHub workflow. The runner enforces
> this: `bench/run.mjs` refuses to start unless it runs inside the image built from `bench/Dockerfile`, so the `bench`
> and `bench:smoke` scripts exit 1 on a host (no override). The only safe local command is the pure unit project:
> `bunx vitest run --project bench`.

**Phase 1 covers scenarios 1–5 and skips the SQLite read (6) in every app**: there is no v1 database API on master
(DB1 #145 is planned), `node:sqlite` is still experimental, and `bun:sqlite` is Bun-only. The report says so. NestJS,
AdonisJS, Laravel, the `sauf build` run and the docs results page are phase 2.

## Docker

`bench/Dockerfile` pins Node 22.23.5 and Bun 1.3.14 by image digest (see the comments there). The build context is the
repo root; `.dockerignore` keeps `.git`, `node_modules`, `dist` and `bench/out` out of the image.

```sh
docker build -f bench/Dockerfile -t laratype-bench .
mkdir -p bench/out
docker run --rm -v "$PWD/bench/out:/out" laratype-bench
```

On PowerShell, mount with the Windows path: `-v "${PWD}\bench\out:/out"`. The image's default command is
`bun run bench`; the report is written to `/out`, so it lands in the host's `bench/out/` as
`<short-sha>-<UTC>.json` and `.md`. `bench/out/` is gitignored; results are never committed.

Already-built image, different profile (arguments are passed through the root script):

```sh
docker run --rm -v "$PWD/bench/out:/out" laratype-bench bun run bench --apps hono --runtimes node,bun --duration 30
```

The same settings are available as environment variables, which is how the workflow passes its dispatch inputs:
`BENCH_APPS`, `BENCH_RUNTIMES`, `BENCH_SCENARIO`, `BENCH_CONNECTIONS`, `BENCH_DURATION`, `BENCH_WARMUP`, `BENCH_OUT`.
Flags win over the environment. `BENCH_NODE` / `BENCH_BUN` pick the runtime binaries, and
`BENCH_ALLOW_NODE_MISMATCH=1` records a Node that is not the bench's Node 22.23.5 (the `bench/Dockerfile` pin) instead
of failing.

The Docker build context has no `.git`, so the container cannot read the commit. For a report with the real commit,
pass `-e BENCH_GIT_SHA="$(git rev-parse HEAD)" -e BENCH_GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"` (and
`-e BENCH_GIT_DIRTY=1` if the tree is dirty); otherwise the report says `unknown`.

`bench:smoke` is the container/CI self-check (exact status and body of every scenario, plus one 1 s autocannon run per
app/runtime). Use it through Docker, not on the host:

```sh
docker run --rm -v "$PWD/bench/out:/out" laratype-bench bun run bench:smoke
```

Both scripts are container commands: `bench/Dockerfile` sets `LARATYPE_BENCH_CONTAINER=1` and `bench/run.mjs` checks it
before parsing any flag or picking a port. On a host, `bun run bench` (or `bench:smoke`) prints one line
(`bench/run.mjs runs only inside bench/Dockerfile ...; see bench/README.md`) and exits 1; there is no override flag.

## The `bench` workflow

`.github/workflows/bench.yml` builds the same image and runs it on a GitHub runner; it is the validation path for this
change (the first CI run is the validation, no local benchmark run is). The job runs `bench:smoke` in the image first
(one request per scenario plus a 1 s autocannon run per selected app/runtime), so a broken app fails in seconds, then
the measured run.

- **On a pull request:** add the `bench` label. A `pull_request` workflow runs from the PR's merge ref, so a
  `bench.yml` added in the PR already runs on `labeled` for that PR, before merge (a fork PR may need a maintainer's
  approval before GitHub runs its workflows). The job runs only for the `bench` label (`pull_request`, never
  `pull_request_target`), with `contents: read`, no secrets and a 60-minute timeout. Re-add the label to rerun. Only a
  new `bench` label add cancels the bench that is running: any other label starts a run in its own concurrency group
  whose job is skipped by the `if`, so it cannot cancel the bench. Only users with triage/write access can label.
- **On master (after merge):** Actions › `bench` › Run workflow. `workflow_dispatch` only lists a file that is on the
  default branch, so this button appears once `bench.yml` is on `master`. The optional inputs are apps, runtimes,
  measured duration and connections; they reach the container as environment only.
- The JSON + Markdown report is uploaded as the `bench-report` artifact, and the Markdown is appended to the job
  summary. A report of a failed run is still uploaded, if one was written.

So the first run needs no merge: add the `bench` label on this PR. Only `workflow_dispatch` needs the file on the
default branch. There is no branch-dispatch fallback: `gh workflow run bench.yml --ref <branch>` is not a supported
path. Agents never add the label and never trigger a run.

## Unit tests (safe locally)

The runner's pure code is covered without starting a server or a load generator:

```sh
bunx vitest run --project bench
```

This runs in about a second and is part of `bun run test --run`. The project only collects `bench/__tests__/**`; the
unit project excludes `bench/**`. No package script starts the benchmark from the test path: `bench` and `bench:smoke`
are explicit container commands, and the `vitest.bench.config.ts` project imports only `bench/lib/*` and
`bench/scenarios.mjs`. The container guard is a pure function too: `bench/__tests__/container.test.mjs` checks the
`LARATYPE_BENCH_CONTAINER` marker, the exact refusal line and that no other value passes; it never spawns `run.mjs`.

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
- The bench pins `@hono/node-server` 2.1.7 (patched for GHSA-rmxm-3fg6-px4f); the root and `sauf` workspaces resolve
  the same 2.1.7 entry.
- Metrics: req/s, p50/p99 latency, cold start (spawn → first 200 on `/health`), RSS at idle and under load (from the
  child pid: `/proc/<pid>/status` on Linux, `tasklist` on Windows, `ps` on macOS). A failed run is recorded and the
  suite continues; it exits 1 at the end. A measured scenario is `ok` only when autocannon reports no error and no
  timeout, at least one completed response, and every completed response carries the scenario's `expectedStatus`
  (the 422 scenario is valid, not an error).
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
folder under `apps/` plus the `APPS` list in `lib/args.mjs`. Keep the body/status comparison exact; the smoke is the
check.
