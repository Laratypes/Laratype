---
area: services
packages: ["@laratype/core", "@laratype/console", "@laratype/log", "@laratype/cache", "@laratype/storage", "@laratype/queue", "@laratype/mail", "@laratype/i18n", "@laratype/schedule", "@laratype/broadcast", "@laratype/contract", "@laratype/client"]
issues: [115, 158, 160, 161, 165, 166, 167, 168, 169, 170, 171, 175, 176, 177, 178]
verified-against: Laratype@256a743 (0.5 state also checked on v0.5.4 @ 053be38)
last-verified: 2026-10-10
---

# Services

The application services: the driver `Manager`, console commands, events, cache, storage, queues, mail, localization, the scheduler, processes and broadcasting.

> **Planned only, except Localization.** No other v1 service code exists. Every other section is `planned → #N` and holds a **Design (non-binding)** note built from the issue bodies. Signatures appear only where an issue states them. A name in backticks below is the name its issue uses. Its parameters and return type are not specified yet. Public API, Invariants, Diagnostics and Example are left out until code lands ([README](./README.md)).

**State on master (0.5):** checked on `256a743`. The same files are unchanged on `v0.5.4`.
- `@laratype/console` has a `Command` base class with static `signature`, `description`, `options` and `arguments` and a `handle()` method ([`Command.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/console/src/command/Command.ts#L1-L34)). sauf loads app commands from `app/src/console/commands/*.ts` and from the default export of `app/routes/console.ts` ([`sauf/src/utils/index.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/utils/index.ts#L10-L34)).
- `@laratype/log` has a `Logger` on winston. The config type allows the channels `"stack" | "single" | "daily"` ([`Config.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/contracts/Config.ts#L33-L53)), but only `single` is implemented. Any other channel throws `DriverNotImplement` ([`Logger.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/log/src/Logger.ts#L29-L36)).
- `packages/mail`, `storage`, `schedule` and `broadcast` contain only `package.json`; `packages/i18n` is the proposed I1 package.
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
| [Localization](#localization) | proposed (I1 [#167](https://github.com/Laratypes/Laratype/issues/167)) |
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
- **Uploads:** the request pipeline gives multipart file fields as the web `File` ([validation.md › Pipeline validation and 422](./validation.md#pipeline-validation-and-422)). ST1 decides whether storage wraps it as `UploadedFile` with `store()`.
- **Testing:** `Storage.fake()`.
- **CLI:** `sauf storage:link` ([cli.md](./cli.md#command-list)).
- **Config:** a typed `config/filesystems.ts`.

### Open questions
- Whether to wrap the web `File` as `UploadedFile` → [#168](https://github.com/Laratypes/Laratype/issues/168)

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
- Jobs serialize a model by its `primaryKey` (the `BindableModel` metadata agreed in S5 [#88](https://github.com/Laratypes/Laratype/issues/88) step 1). How a job re-fetches it by primary key when `routeKeyName` differs (`findByRouteKey` looks up the route key) is open → [#169](https://github.com/Laratypes/Laratype/issues/169).

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
proposed: PR [#361](https://github.com/Laratypes/Laratype/pull/361) @ df00787 (I1, M3, `@laratype/i18n`). Depends on K1 #152, B1 #125, D6 #112, C3 #91.

### Public API
`packages/i18n/src/index.ts` at the Status SHA.

```ts
// lang/<locale>/<file>.ts
export const defineLang: <const T extends LangTree>(messages: T) => T
export type LangTree = { readonly [key: string]: string | PluralForms | LangTree }
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other"
export type PluralForms = { readonly other: string } & Partial<Record<Exclude<PluralCategory, "other">, string>>
export interface Register {} // { lang: { <file>: typeof import("../lang/en/<file>").default } }

export function trans<K extends LangKey>(key: K, ...args: TransArgs<K>): string
export const __: typeof trans
export class Translator {
  constructor(catalog?: LangCatalog, options?: TranslatorOptions); // defaults outside a request
  static current(): Translator;
  trans<K extends LangKey>(key: K, ...args: TransArgs<K>): string;
  translate(key: string, params?: MessageParams, locale?: string): string; // dynamic keys
  has(key: string, locale?: string): boolean;
  getLocale(): string;
  setLocale(locale: string): void;
  getFallbackLocale(): string;
  locales(): string[];
}
export class Lang extends Facade { /* trans, getLocale, setLocale, getFallbackLocale, locales, has, fake() */ }
export function getLocale(): string
export function setLocale(locale: string): void
export function locales(): string[]
export class Locale {} // @Injectable({ scope: "request" }), the request's locale
export class LocaleMiddleware extends Middleware {} // 0.5 Middleware; defineMiddleware is follow-up #352
export class I18nServiceProvider extends ServiceProvider { register(): Promise<void> }
export function validationMessage(rule: string, params?: MessageParams, locale?: string): string
export function loadMessages(manifest?: AppManifest): Promise<LangCatalog>
export class I18nError extends Error
export const LOCALE_QUERY: "locale"

export type AppLangs = /* Register.lang, or Record<string, LangTree> */
export type LangKey = /* every "<file>.<dotted key>" of Register.lang */ string
export type LangPaths<T, Prefix extends string = ""> = /* every dotted leaf path of T */ string
export type TransParams<K extends string = LangKey> = /* the placeholders of K: string, count: number */ unknown
export type TransArgs<K extends string = LangKey> = /* [] when no params, [params, locale?] otherwise */ unknown
export type MessageParams = Record<string, string | number>
export type LangCatalog = Readonly<Record<string, Readonly<Record<string, LangTree>>>>
export interface TranslatorOptions { locale?: string; fallbackLocale?: string }
```

**Config:** `app/config/i18n.ts` default-exports `defineConfig({ locale, fallback_locale })`, read as `config("i18n.locale")` / `config("i18n.fallback_locale")`. Without it, the 0.5 single config file's `config.locale` / `config.fallback_locale` are read; a locale that is still unset defaults to `en`, and the fallback defaults to the default locale.

**Manifest:** `AppManifest.lang` is the `lang` kind: one entry per `lang/<locale>/<file>.ts`, named `<locale>/<file>` (build.md › manifest). The build tsconfig must include `lang/**/*`: a lang file outside the build program is left out of `dist/app.manifest.js`, and `sauf build` warns that production has no translations for it (`trans()` then returns raw keys).

### Invariants
- **Keys** are `<file>.<dotted key>` (`messages.greeting`, `validation.required`). A registered `Register.lang` makes an unknown key, a missing placeholder param and an extra param type errors. `"Hello {name}"` takes `{ name: string }`; a `{count}` placeholder and every plural take `{ count: number }`. Key typing uses the K1/Q16 module-augmentation pattern; generating it from the manifest is a follow-up. A file name or a key segment cannot contain `.`: lookup splits the key on dots, so `loadMessages()` rejects one with `I18nError`. A file root is always a container (`messages.one`, `messages.other`), never a plural leaf; a plural object below the root is a leaf.
- **Plurals** are a leaf object whose keys are all `Intl.PluralRules` categories (`zero|one|two|few|many|other`, `other` required); `Intl.PluralRules` selects the form from `params.count`. The locale is normalized before the rules are built, so a `fr_FR` folder uses the French rules.
- **Matching and fallback:** a locale matches exactly, then by base language (`en-US` → `en`), then by another region of the same language (`en` → `en-US`); `LocaleMiddleware` and the catalog lookup use the same matching. A message is looked up in the requested locale, then in `fallback_locale` (matched the same way), then the key itself is returned. A missing key never throws.
- **Locale per request (D6):** `Locale` is request-scoped; `LocaleMiddleware` reads `?locale=`, then the authenticated user's `locale`, then the `Accept-Language` q-list, then leaves the app default. Only locales with a catalog (plus the default and fallback) are accepted, and `?locale=` wins. A header tag with `q=0` is an exclusion: a catalog locale it names exactly is never chosen from the header. A range with a malformed `q` (empty, non-numeric, outside `0..1`, or more than three decimals) is skipped: it is neither an exclusion nor `q=1`. Register the middleware after the auth middleware, or the user preference is not set yet. Outside a request, `setLocale()` changes the translator default (CLI, queued jobs); inside a request with no request container (a route not served through `RequestKernel`) it leaves the shared default unchanged and warns once in dev, so it cannot leak into later requests.
- **Validation messages:** `validationMessage(rule, params?, locale?)` reads the app's `validation.<rule>` (for example `lang/vi/validation.ts` exporting `{ required: "..." }`), or its built-in English default. Standard Schema issues carry no rule code, so H10 maps an issue to its rule and passes that rule name; that issue→rule map remains H10's work (Refs [#167](https://github.com/Laratypes/Laratype/issues/167)).
- **Provider:** `I18nServiceProvider` loads the catalog once and binds `Translator`; add it to `app/config/providers.ts`.

### Diagnostics
- `I18nError`: `[@laratype/i18n] lang entry "<name>" (<path>) must be named <locale>/<file>: put each file in lang/<locale>/`
- `I18nError`: `[@laratype/i18n] <path> must default-export an object of messages (defineLang({...}))`
- `I18nError`: `[@laratype/i18n] <path>: lang folder "<locale>" and "<known>" are the same locale ("<normalized>"): spell a locale one way`
- `I18nError`: `[@laratype/i18n] <path>: file name "<file>" contains ".": keys are <file>.<dotted key>, so a dot cannot be part of a file name or key`
- `I18nError`: `[@laratype/i18n] <path>: message key "<file>.<dotted key>" contains ".": keys are <file>.<dotted key>, so a dot cannot be part of a file name or key`
- `I18nError`: `[@laratype/i18n] <path>: message "<file>.<dotted key>" must be a string or a plural object ({ other, one, two, few, many, zero } with string templates)`
- `LocaleMiddleware` on a route without a request container (not served through `RequestKernel`) skips, leaves the app default and prints one dev warning per process; changing the shared default there would leak into later requests.
- `setLocale()` (and `Lang.setLocale()`) on a route without a request container skips the same way, leaving the app default and printing the same one-time dev warning, naming `setLocale()`.
- Type errors: an unknown key, a missing placeholder param, an extra param, or a non-string placeholder value.

### Example
```ts
// app/declare/i18n.d.ts
import messages from "../../lang/en/messages"
declare module "@laratype/i18n" { interface Register { lang: { messages: typeof messages } } }

// controller
__("messages.greeting", { name: "Ada" })
```

### Non-goals
- JSON export per locale: not in this package yet; remaining in [#167](https://github.com/Laratypes/Laratype/issues/167).
- FormRequest v2 wiring is H10 [#137](https://github.com/Laratypes/Laratype/issues/137); this package provides the lookup.
- `defineMiddleware` typing is PR [#352](https://github.com/Laratypes/Laratype/pull/352); `LocaleMiddleware` uses the 0.5 `Middleware` class.

### Open questions
- The JSON export's shape and command → [#167](https://github.com/Laratypes/Laratype/issues/167).

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
- **Channels:** public, private and presence. Channels are declared in `app/routes/channels.ts`, and params are inferred from channel names (`orders.:id`), as in the contract's path params ([contract.md › Path params](./contract.md#path-params)).
- **Auth:** a `/broadcasting/auth` endpoint that applies the auth guard ([auth.md › Authentication from the contract](./auth.md#authentication-from-the-contract)).
- **Drivers:** the Pusher protocol (Pusher, Soketi), redis pub/sub, a built-in WebSocket server (`@hono/node-ws` / Bun), log and null. Built on the [Manager](#driver-manager).

### Open questions
- Resolved: `app/routes/channels.ts` sits next to `api.ts` ([overview.md › Project structure](./overview.md#project-structure), [#177](https://github.com/Laratypes/Laratype/issues/177)).

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
