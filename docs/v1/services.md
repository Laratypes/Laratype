---
area: services
packages: ["@laratype/core", "@laratype/console", "@laratype/log", "@laratype/cache", "@laratype/storage", "@laratype/queue", "@laratype/mail", "@laratype/i18n", "@laratype/schedule", "@laratype/broadcast", "@laratype/contract", "@laratype/client"]
issues: [115, 158, 160, 161, 165, 166, 167, 168, 169, 170, 171, 175, 176, 177, 178]
verified-against: Laratype@256a743 (0.5 state also checked on v0.5.4 @ 053be38)
last-verified: 2026-10-10
---

# Services

The application services: the driver `Manager`, console commands, events, cache, storage, queues, mail, localization, the scheduler, processes and broadcasting.

> **Planned only.** No v1 service code exists. Every section is `planned → #N` and holds a **Design (non-binding)** note built from the issue bodies. Signatures appear only where an issue states them. A name in backticks below is the name its issue uses. Its parameters and return type are not specified yet. Public API, Invariants, Diagnostics and Example are left out until code lands ([README](./README.md)).

**State on master (0.5):** checked on `256a743`. The same files are unchanged on `v0.5.4`.
- `@laratype/console` has a `Command` base class with static `signature`, `description`, `options` and `arguments` and a `handle()` method ([`Command.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/console/src/command/Command.ts#L1-L34)). sauf loads app commands from `app/src/console/commands/*.ts` and from the default export of `app/routes/console.ts` ([`sauf/src/utils/index.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/utils/index.ts#L10-L34)).
- `@laratype/log` has a `Logger` on winston. The config type allows the channels `"stack" | "single" | "daily"` ([`Config.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/contracts/Config.ts#L33-L53)), but only `single` is implemented. Any other channel throws `DriverNotImplement` ([`Logger.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/log/src/Logger.ts#L29-L36)).
- `packages/mail`, `i18n`, `storage`, `schedule` and `broadcast` contain only `package.json`.
- There is no events, cache, queue or process package.

| Section | Status |
|---|---|
| [Shared service rules](#shared-service-rules) | planned → #160, #115, #158, #165 |
| [Driver Manager](#driver-manager) | planned → #160 |
| [Console commands](#console-commands) | planned → #161 |
| [Events and listeners](#events-and-listeners) | planned → #165 |
| [Cache](#cache) | planned → #166 |
| [Storage](#storage) | planned → #168 |
| [Queue](#queue) | planned → #169 |
| [Job chains and batches](#job-chains-and-batches) | planned → #175 |
| [Mail](#mail) | planned → #170 |
| [Localization](#localization) | planned → #167 |
| [Scheduler](#scheduler) | planned → #171 |
| [Process](#process) | planned → #176 |
| [Broadcasting server](#broadcasting-server) | planned → #177 |
| [Typed broadcast channels](#typed-broadcast-channels) | planned → #178 |

---

## Shared service rules

### Status
planned → [#160](https://github.com/Laratypes/Laratype/issues/160) (F1), [#115](https://github.com/Laratypes/Laratype/issues/115) (D8), [#158](https://github.com/Laratypes/Laratype/issues/158) (T5), [#165](https://github.com/Laratypes/Laratype/issues/165) (EV1).

### Design (non-binding)
Rules every service section below follows. Per-service detail comes only from that service's issue; anything else is not settled yet.
- **Drivers:** every driver-based service is built on the [Manager](#driver-manager): `driver(name)`, `extend()`, a default driver from config, and driver names typed by config keys ([config.md](./config.md)).
- **Facades:** every service has a facade with `fake()` for tests ([di.md › Container-backed registries and facades](./di.md#container-backed-registries-and-facades)).
- **Container-created classes:** listeners, jobs, mailables and commands are created by the container (`app.make()`), so constructor DI works without decorators ([di.md › Dependency metadata](./di.md#dependency-metadata)).
- **Jobs:** a job's constructor holds the payload, and `handle()` receives its dependencies by method injection ([di.md › Method injection](./di.md#method-injection)).
- **Listener discovery:** the DI transform reads `handle(event: X)` to register a listener for event `X` automatically ([Events and listeners](#events-and-listeners)).

### Acceptance
Each service's own issue, linked in its section.

---

## Driver Manager

### Status
planned → [#160](https://github.com/Laratypes/Laratype/issues/160) (F1, M3). Depends on D1 #96, D8 #115, K1 #152.

### Design (non-binding)
- **Base class:** `Manager<Drivers>` in `@laratype/core`, with `driver(name?)`, `extend(name, factory)` and an instance cache per driver name.
- **Typing:** the default driver and the driver names are typed from config keys (K1, [config.md](./config.md)).
- **Facades:** integrates with facade `fake()` (D8).
- **Users:** cache, queue, mail, storage, broadcast and log follow this pattern ([#160](https://github.com/Laratypes/Laratype/issues/160) context). Log is ported onto it: its channels in `packages/log/src/Logger.ts` become manager drivers.

### Open questions
- How the config type reaches the manager's driver names → [#152](https://github.com/Laratypes/Laratype/issues/152)

### Acceptance
[#160 Done when](https://github.com/Laratypes/Laratype/issues/160)

---

## Console commands

### Status
planned → [#161](https://github.com/Laratypes/Laratype/issues/161) (F2, M3). Depends on D4 #99, B1 #125, T2 #102.

### Design (non-binding)
- **Resolution:** commands are resolved with `app.make()`, so they get constructor DI. In 0.5 they are created without DI.
- **Typed signatures:** a signature such as `"send:mail {user} {--queue=}"` types `this.argument('user')` and `this.option('queue')`. The parser uses template literal types, the technique of the contract's path params ([contract.md › Path params](./contract.md#path-params)).
- **Closure commands** in `routes/console.ts`.
- **Registration** through the build manifest (B1, [build.md › Plugin chain](./build.md#plugin-chain)) instead of path discovery.
- The scheduler, the queue worker and the other `sauf` commands rely on container-resolved commands. The CLI's own command list is in [cli.md](./cli.md).

### Open questions
- The form of a closure command in `routes/console.ts` → [#161](https://github.com/Laratypes/Laratype/issues/161)
- Whether the 0.5 static `options` / `arguments` arrays stay next to the typed signature → [#161](https://github.com/Laratypes/Laratype/issues/161)

### Acceptance
[#161 Done when](https://github.com/Laratypes/Laratype/issues/161)

---

## Events and listeners

### Status
planned → [#165](https://github.com/Laratypes/Laratype/issues/165) (EV1, M3). Depends on D1 #96, D8 #115, T1 #101, B1 #125.

### Design (non-binding)
- **Events** are classes. **Listeners** are resolved by the container (constructor DI).
- **Registration:** through `EventServiceProvider.listen`, or by discovery. For discovery, the DI transform (T1) records the event type from the listener's `handle(event: X)`.
- **Dispatch:** typed `Event.dispatch(new UserRegistered(user))`; subscribers.
- **Testing:** `Event.fake()` with `assertDispatched` / `assertNotDispatched`.
- **Used by:** queued listeners (`ShouldQueue`, [Queue](#queue)), broadcasting ([Broadcasting server](#broadcasting-server)) and model lifecycle hooks ([database.md](./database.md)).

### Open questions
- The package that holds events (#165 names none) → [#165](https://github.com/Laratypes/Laratype/issues/165)
- How the transform records the event type. The T1 output carries constructor dependencies only ([di.md › DI transform](./di.md#di-transform)) → [#165](https://github.com/Laratypes/Laratype/issues/165)

### Acceptance
[#165 Done when](https://github.com/Laratypes/Laratype/issues/165)

---

## Cache

### Status
planned → [#166](https://github.com/Laratypes/Laratype/issues/166) (CA1, M3, `@laratype/cache`). Depends on F1 #160, K1 #152, H11 #138.

### Design (non-binding)
- **Stores:** memory, file, redis (`ioredis`), and array for tests. Built on the [Manager](#driver-manager).
- **Operations:** `get`, `put`, `add`, `remember`, `forget`, `flush`, `increment`. `remember` infers its type from the callback.
- **Locks:** `Cache.lock()` gives atomic locks, which the [scheduler](#scheduler) uses for overlap control. #166 also names unique jobs ([Queue](#queue)) as a lock user.
- **Interceptor:** a `cache(ttl)` interceptor for H11 ([http.md › Interceptors](./http.md#interceptors)).
- **Config:** a typed `config/cache.ts`.

### Open questions
- Unique jobs: #166 names them, but #169 does not list them → [#169](https://github.com/Laratypes/Laratype/issues/169)

### Acceptance
[#166 Done when](https://github.com/Laratypes/Laratype/issues/166)

---

## Storage

### Status
planned → [#168](https://github.com/Laratypes/Laratype/issues/168) (ST1, M3, `@laratype/storage`). Depends on F1 #160, K1 #152, H3 #106.

### Design (non-binding)
- **Disks:** local, and s3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) with a custom endpoint for R2 and MinIO. Built on the [Manager](#driver-manager).
- **Operations:** `put`, `get`, `stream`, `delete`, `exists`, `url`, `temporaryUrl`, `copy`, `move`.
- **Uploads:** `UploadedFile.store()` for multipart uploads parsed by the request pipeline ([http.md › Request pipeline](./http.md#request-pipeline)).
- **Testing:** `Storage.fake()`.
- **CLI:** `sauf storage:link` ([cli.md](./cli.md#command-list)).
- **Config:** a typed `config/filesystems.ts`.

### Open questions
- `UploadedFile` is not specified in the request pipeline yet → [#106](https://github.com/Laratypes/Laratype/issues/106)

### Acceptance
[#168 Done when](https://github.com/Laratypes/Laratype/issues/168)

---

## Queue

### Status
planned → [#169](https://github.com/Laratypes/Laratype/issues/169) (Q1, M3, `@laratype/queue`). Depends on F1 #160, EV1 #165, T5 #158, D6 #112, B1 #125.

### Design (non-binding)
- **Jobs:** a job class takes its payload in the constructor. It is serialized as the job name (from the build manifest) plus JSON arguments. Models are serialized by primary key and fetched again.
- **Dependencies:** `handle()` receives them by method injection ([di.md › Method injection](./di.md#method-injection)).
- **Drivers:** sync and redis (BullMQ). A database driver comes after DB4 ([database.md](./database.md)). Built on the [Manager](#driver-manager).
- **Dispatch:** `dispatch(job).delay().onQueue().onConnection()`, with retries, backoff and timeout.
- **Failures:** a failed job store; `sauf queue:work`, `queue:failed` and `queue:retry` ([cli.md](./cli.md#command-list)).
- **Queued listeners:** `ShouldQueue` ([Events and listeners](#events-and-listeners)).
- **Scope:** each job runs in its own request scope ([di.md › Request scope and scope bubbling](./di.md#request-scope-and-scope-bubbling)).
- **Testing:** `Queue.fake()` with assertions.
- **Deployment:** the Heroku `Procfile` stub runs `worker: sauf queue:work` ([#172](https://github.com/Laratypes/Laratype/issues/172)). Vercel has no long-running queue worker ([#173](https://github.com/Laratypes/Laratype/issues/173)).

### Open questions
- How a model is serialized by primary key before the ORM is chosen → [#88](https://github.com/Laratypes/Laratype/issues/88)

### Acceptance
[#169 Done when](https://github.com/Laratypes/Laratype/issues/169)

---

## Job chains and batches

### Status
planned → [#175](https://github.com/Laratypes/Laratype/issues/175) (Q2, M4). Depends on Q1 #169, DB4 #148.

### Design (non-binding)
- **Chains:** `Bus.chain([...]).catch().dispatch()`.
- **Batches:** `Bus.batch([...]).then().catch().finally().allowFailures().dispatch()`, with progress and cancel.
- **Parallel execution** through BullMQ flows. Batches are stored in a `job_batches` table, which needs the migration runner ([database.md](./database.md)).

### Acceptance
[#175 Done when](https://github.com/Laratypes/Laratype/issues/175)

---

## Mail

### Status
planned → [#170](https://github.com/Laratypes/Laratype/issues/170) (ML1, M3, `@laratype/mail`). Depends on F1 #160, K1 #152, Q1 #169.

### Design (non-binding)
- **Mailables:** `Mailable` classes with an envelope, content (HTML from `hono/jsx` rendered to a string, plus text) and attachments. Attachments come from [Storage](#storage) once it exists.
- **Transports:** smtp (`nodemailer`), ses (`@aws-sdk/client-sesv2`), log and array. Built on the [Manager](#driver-manager).
- **Sending:** `Mail.to(user).send(mailable)`, and `.queue()` through the [Queue](#queue).
- **Container:** a `MAILER` token binding ([di.md › Tokens](./di.md#tokens)); a typed `config/mail.ts`.
- **Testing:** `Mail.fake()` with `assertSent` / `assertQueued`.

### Acceptance
[#170 Done when](https://github.com/Laratypes/Laratype/issues/170)

---

## Localization

### Status
planned → [#167](https://github.com/Laratypes/Laratype/issues/167) (I1, M3, `@laratype/i18n`). Depends on K1 #152, B1 #125, D6 #112, C3 #91.

### Design (non-binding)
- **Files:** translations live in `lang/{locale}/*.ts` with typed keys, discovered by the build manifest.
- **Lookup:** `__()` / `trans()`. The key and the placeholder params are inferred: `"Hello {name}"` → `{ name: string }`.
- **Locale:** a locale middleware reads Accept-Language, the query or the user's preference. The locale is stored per request (D6, [di.md › Request scope and scope bubbling](./di.md#request-scope-and-scope-bubbling)).
- **Fallback** from `config.fallback_locale`; plurals through `Intl.PluralRules`. The 0.5 app config already has `locale` and `fallback_locale` ([`Config.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/contracts/Config.ts#L25-L26)).
- **Validation messages:** default localized messages from Standard Schema issues, used by FormRequest v2 ([validation.md › FormRequest v2](./validation.md#formrequest-v2)).
- **FE:** an optional JSON export per locale.

### Open questions
- Where `lang/` sits in the project layout ([overview.md › Project structure](./overview.md#project-structure)) → [#167](https://github.com/Laratypes/Laratype/issues/167)

### Acceptance
[#167 Done when](https://github.com/Laratypes/Laratype/issues/167)

---

## Scheduler

### Status
planned → [#171](https://github.com/Laratypes/Laratype/issues/171) (SC1, M3, `@laratype/schedule`). Depends on F2 #161, CA1 #166, Q1 #169.

### Design (non-binding)
- **Definition:** `schedule(s => ...)` in `routes/console.ts`, with `s.command()`, `s.job()` and `s.call()`.
- **Frequencies:** cron expressions (`croner`) and fluent frequencies (`daily()`, `everyFiveMinutes()`, ...).
- **Timezone** from `config.schedule_timezone`, which the 0.5 app config already has ([`Config.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/contracts/Config.ts#L24)).
- **Overlap:** `withoutOverlapping()` / `onOneServer()` use `Cache.lock` ([Cache](#cache)).
- **CLI:** `sauf schedule:run`, `schedule:work`, `schedule:list` ([cli.md](./cli.md#command-list)).
- **Vercel:** Vercel Cron calls `schedule:run` through a route protected by a secret ([#173](https://github.com/Laratypes/Laratype/issues/173)).

### Acceptance
[#171 Done when](https://github.com/Laratypes/Laratype/issues/171)

---

## Process

### Status
planned → [#176](https://github.com/Laratypes/Laratype/issues/176) (PR1, M4). Depends on D8 #115.

### Design (non-binding)
- **Facade:** `Process.run`, `start`, `pool` and `pipe`, with timeout, env, cwd and streamed output (`node:child_process`).
- **Testing:** `Process.fake()` with assertions.

### Non-goals
- Edge runtimes: `Process` is marked not edge-safe and is excluded by the edge adapters (X2 [#156](https://github.com/Laratypes/Laratype/issues/156)).

### Open questions
- The package that holds `Process` (#176 names none) → [#176](https://github.com/Laratypes/Laratype/issues/176)

### Acceptance
[#176 Done when](https://github.com/Laratypes/Laratype/issues/176)

---

## Broadcasting server

### Status
planned → [#177](https://github.com/Laratypes/Laratype/issues/177) (BR1, M4, `@laratype/broadcast`). Depends on EV1 #165, Q1 #169, A2 #120.

### Design (non-binding)
- **Events:** `ShouldBroadcast` events ([Events and listeners](#events-and-listeners)) with `broadcastOn()` and a typed payload, queued through the [Queue](#queue).
- **Channels:** public, private and presence. Channels are declared in `routes/channels.ts`, and params are inferred from channel names (`orders.:id`), as in the contract's path params ([contract.md › Path params](./contract.md#path-params)).
- **Auth:** a `/broadcasting/auth` endpoint that uses `auth()` ([auth.md › auth() middleware](./auth.md#auth-middleware)).
- **Drivers:** the Pusher protocol (Pusher, Soketi), redis pub/sub, a built-in WebSocket server (`@hono/node-ws` / Bun), log and null. Built on the [Manager](#driver-manager).

### Open questions
- Where `routes/channels.ts` sits in the project layout ([overview.md › Project structure](./overview.md#project-structure)) → [#177](https://github.com/Laratypes/Laratype/issues/177)

### Acceptance
[#177 Done when](https://github.com/Laratypes/Laratype/issues/177)

---

## Typed broadcast channels

### Status
planned → [#178](https://github.com/Laratypes/Laratype/issues/178) (BR2, M4). Depends on BR1 #177, CL1 #109.

### Design (non-binding)
- **Contract:** `defineChannel('orders.:id', { events: { shipped: schema } })` in `@laratype/contract`, so realtime events stay contract-first and the FE gets typed payloads. The contract package stays browser-safe ([overview.md › Package graph](./overview.md#package-graph)).
- **Client:** a typed subscription API in `@laratype/client`.

### Open questions
- Pusher-compatible or native WebSocket transport for the client (#178 names both) → [#178](https://github.com/Laratypes/Laratype/issues/178)

### Acceptance
[#178 Done when](https://github.com/Laratypes/Laratype/issues/178)
