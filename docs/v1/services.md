---
area: services
packages: ["@laratype/core", "@laratype/console", "@laratype/log", "@laratype/cache", "@laratype/storage", "@laratype/queue", "@laratype/mail", "@laratype/i18n", "@laratype/schedule", "@laratype/broadcast", "@laratype/contract", "@laratype/client"]
issues: [115, 158, 160, 161, 165, 166, 167, 168, 169, 170, 171, 175, 176, 177, 178]
verified-against: Laratype@256a743 (0.5 state also checked on v0.5.4 @ 053be38; + F2 console commands at feb1557)
last-verified: 2026-10-29
---

# Services

The application services: the driver `Manager`, console commands, events, cache, storage, queues, mail, localization, the scheduler, processes and broadcasting.

> **Planned only, except [Console commands](#console-commands).** Console commands is proposed by F2 [#161](https://github.com/Laratypes/Laratype/issues/161) in this PR. Every other section is `planned → #N` and holds a **Design (non-binding)** note built from the issue bodies. Signatures appear only where an issue states them. A name in backticks below is the name its issue uses. Its parameters and return type are not specified yet. Public API, Invariants, Diagnostics and Example are left out until code lands ([README](./README.md)).

**State on master (0.5):** checked on `256a743`. The same files are unchanged on `v0.5.4`.
- `@laratype/console` has a `Command` base class with static `signature`, `description`, `options` and `arguments` and a `handle()` method ([`Command.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/console/src/command/Command.ts#L1-L34)). sauf loads app commands from `app/src/console/commands/*.ts` and from the default export of `app/routes/console.ts` ([`sauf/src/utils/index.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/utils/index.ts#L10-L34)).
- `@laratype/log` has a `Logger` on winston. The config type allows the channels `"stack" | "single" | "daily"` ([`Config.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/contracts/Config.ts#L33-L53)), but only `single` is implemented. Any other channel throws `DriverNotImplement` ([`Logger.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/log/src/Logger.ts#L29-L36)).
- `packages/mail`, `i18n`, `storage`, `schedule` and `broadcast` contain only `package.json`.
- There is no events, cache, queue or process package.

| Section | Status |
|---|---|
| [Shared service rules](#shared-service-rules) | planned → #160, #115, #158, #165 |
| [Driver Manager](#driver-manager) | planned → #160 |
| [Console commands](#console-commands) | proposed: PR #? @ feb1557 (F2 [#161](https://github.com/Laratypes/Laratype/issues/161)) |
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
proposed: PR #? @ feb1557 ([#161](https://github.com/Laratypes/Laratype/issues/161), F2, M3). Depends on D4 #99, B1 #125, T2 #102.

The 0.5 static `options` / `arguments` arrays stay registered for commands that already declare them, but the signature is the only source of the typed name, arguments and options. Dropping the arrays is the breaking change recorded on [#161](https://github.com/Laratypes/Laratype/issues/161).

### Public API

The types live in [`signature.ts` @ feb1557](https://github.com/Laratypes/Laratype/blob/feb15573cd10608ae8fc46237bb1a0bc0bbe3b20/packages/console/src/command/signature.ts), [`Command.ts` @ feb1557](https://github.com/Laratypes/Laratype/blob/feb15573cd10608ae8fc46237bb1a0bc0bbe3b20/packages/console/src/command/Command.ts), [`closure.ts` @ feb1557](https://github.com/Laratypes/Laratype/blob/feb15573cd10608ae8fc46237bb1a0bc0bbe3b20/packages/console/src/command/closure.ts) and the registration in [`sauf/src/utils/command.ts` @ feb1557](https://github.com/Laratypes/Laratype/blob/feb15573cd10608ae8fc46237bb1a0bc0bbe3b20/packages/sauf/src/utils/command.ts).

```ts
// @laratype/console
class Command<S extends string = string> {
  static signature: string;
  static description?: string;
  static bootsApp?: boolean;                 // false: no register() and no provider boot
  static options: string[][] | undefined;    // 0.5 declarations, still read
  static arguments: ArgumentType[] | undefined;

  argument<N extends ArgumentName<S>>(name: N): ArgumentValue<S, N>;
  option<N extends OptionName<S>>(name: N): OptionValue<S, N>;
  opts(): any;
  boot(...args: any[]): void | Promise<void>;
  handle(...args: any[]): unknown;
  providers(providers: Array<typeof ServiceProvider | typeof AppServiceProvider>): Promise<Array<typeof ServiceProvider | typeof AppServiceProvider>>;
  __setInput(input: CommandInput<S>): void;   // filled by sauf before handle()
}

function command<S extends string>(signature: S, handler: (input: CommandInput<S>) => unknown): ClosureCommand<S>;

function parseSignature(signature: string): ParsedSignature;
function optionKey(name: string): string;
function isClosureCommand(value: unknown): value is AnyClosureCommand;
function isConsoleCommand(value: unknown): value is ConsoleCommand;
function overridesProviders(command: { prototype: object }): boolean;

interface ClosureCommand<S extends string = string> {
  readonly [CLOSURE_COMMAND]: true;          // Symbol.for("laratype.console.closure")
  readonly signature: S;
  readonly handler: (input: CommandInput<S>) => unknown;
}
```

`ArgumentName`, `OptionName`, `ArgumentValue`, `OptionValue`, `CommandInput`, `ClosureHandler`, `ParsedSignature`, `SignatureArgument`, `SignatureOption`, `AnyClosureCommand`, `ConsoleCommand` and `CommandClass` are the supporting types. `CommandSignatureError` is the parse error (see Diagnostics).

The signature grammar:

| Token | Meaning |
|---|---|
| `name:sub` | the command name: the first word, before any `{...}` |
| `" : description"` | the command description, after the parameters |
| `{user}` | required argument, `string` |
| `{user?}` | optional argument, `string \| undefined` |
| `{user=default}` | argument with a default, `string` |
| `{users*}` | variadic argument, `string[]` |
| `{--force}` | boolean flag, `boolean \| undefined` |
| `{--queue=}` | option with a required value, `string \| undefined` |
| `{--queue=high}` | option with a default, `string` |
| `{--tag=*}` | variadic option, `string[] \| undefined` |

An argument name or option flag starts with a letter or `_`, then letters, digits, `_` or `-`. An option keeps one dash between its segments (no leading, trailing or doubled dash), because commander camelCases it: `{--dry-run}` is the input key `dryRun`, while `this.option("dry-run")` takes the flag as written.

### Invariants
- **One source.** The signature declares the command name, arguments and options. `sauf` parses it once, at registration. A 0.5 command's `static options` / `static arguments` are registered first for compatibility; a signature token with the same name is not registered twice. New commands use only the signature.
- **Types come from the signature.** `ArgumentName`, `OptionName` and `CommandInput` are template-literal types over `S` (`packages/console/src/command/signature.ts`), the technique of the contract's path params. The class must pass its own signature type: `class SendMail extends Command<typeof SendMail.signature>` with `static readonly signature = "..." as const`. When `S` is plain `string` (every 0.5 command, or no `as const` / `readonly`), `argument()` returns `string`, `option()` returns `string | boolean | undefined`, and `CommandInput` falls back to `Record<string, unknown>` instead of the literal signature's keys.
- **Container resolution.** A command that does not override `providers()` is resolved with `Serve.getContainer().make(Class)` after `register()` and the provider boot, so constructor DI works without decorators ([di.md › Dependency metadata](./di.md#dependency-metadata)). A command that overrides `providers()` keeps the 0.5 order: it is constructed with `new` before the boot so it can filter the provider list itself. `overridesProviders()` tells the two apart across copies of `@laratype/console`, with a shared symbol on the base method.
- **`bootsApp`.** `static bootsApp = false` skips `register()`, the provider boot and the command's own `providers()` filtering (`types:generate`, `make:*`). A closure command always boots the app. The container is still loaded for a DI command with `bootsApp = false`, so its plain class dependencies autowire.
- **One input object.** A closure command's handler receives exactly one `CommandInput<S>`; there are no positional parameters. A class command receives the same object through `__setInput()` and reads it with `argument(name)` / `option(name)`; `handle(...args)` still gets commander's positional arguments for 0.5 code.
- **Registration.** `sauf` loads command classes through the app manifest ([build.md › Plugin chain](./build.md#plugin-chain)) from `app/src/console/commands` and `app/console/commands`, and `app/routes/console.ts` adds class and closure commands as an array. An entry that is not a command is skipped with a warning; a file that fails to load is skipped with its stack. A closure in a command file is skipped, because closure commands live in the route file.
- **Cleanup.** The provider `down()` functions run in reverse order and the dev runner closes after the command body, so a failing `handle()` still cleans up. Every cleanup runs even when one throws; the command's own error stays the one the caller sees.
- **No coercion.** Commander hands every argument and option value as a string (or `true` for a flag, an array for a variadic one); the signature types do not parse numbers, booleans or dates.

### Diagnostics
- `parseSignature()` throws `CommandSignatureError: Invalid command signature "<signature>": <reason>`. The reasons are: `the signature is empty`, `"<name>" is not a valid command name`, `"<token>" is neither an argument nor an option: wrap it in { }`, `"--<body>" is not a valid option name`, `"<body>" is not a valid argument name`, `"<token>" uses a short option: use a long --option instead`, and `"<key>" is declared twice`. An empty `static signature` is rejected by `sauf` before parsing, with `COMMAND_SIGNATURE_NOT_CONFIG_YET` and `Command signature not configured yet`.
- A command file whose default export is not a command class: `Skipped <files>: the default export is not a command class (a class with a static signature)`.
- A non-command entry in the route file: `Skipped <N> entries of app/routes/console.ts: not a command (a class with a static signature, or a closure from command())` (`entry` when `N` is 1). A default export that is not an array gives `Skipped app/routes/console.ts: the default export is not an array of commands`.
- Constructor DI in a production `dist/cli.js` fails with `Cannot autowire <Class>: its constructor takes N param(s) but no dependency metadata was found.` The DI transform runs in `sauf dev` only ([build.md › Plugin chain](./build.md#plugin-chain)).
- Unknown arguments and options are commander's own errors; the wrapper adds no message.

### Example
`examples/basic/app/src/console/commands/SendMail.ts` uses constructor DI and the typed signature:

```ts
export default class SendMail extends Command<typeof SendMail.signature> {
  static readonly signature = "send:mail {user} {--queue=}" as const;

  constructor(private readonly greeting: GreetingService) {
    super();
  }

  async handle() {
    const queue = this.option("queue");                 // string | undefined
    console.log(this.greeting.greet(this.argument("user")), queue);
  }
}
```

`examples/basic/app/routes/console.ts` adds a closure command:

```ts
export default [
  PublishCommand,
  command("hello:user {user} {--shout}", ({ user, shout }) => {
    console.log(shout ? `HELLO ${user.toUpperCase()}` : `Hello ${user}`);  // user: string, shout: boolean | undefined
  }),
];
```

`sauf make:command CleanCache` writes `app/console/commands/CleanCache.ts` with `static readonly signature = "clean:cache" as const` and the `Command<typeof CleanCache.signature>` shape.

### Non-goals
- No interactive prompts, progress bars or table helpers: `Console` keeps `log`, `error`, `warn`, `table` and the other 0.5 helpers.
- No calling commands from code (`Artisan::call`), no command scheduling, no parallel execution, no output capturing.
- No option value coercion or schemas: validation of command input is a later service concern.
- No command discovery outside the manifest, and no DI metadata in the production build until `sauf build` runs the transform ([build.md › Plugin chain](./build.md#plugin-chain)).
- No automatic naming from the class name: the generator derives a starting signature (`SendMail` -> `send:mail`), but the source of truth stays the string.

### Open questions
- Resolved: a closure command is `command(signature, handler)` and its handler takes one typed input object, not positional parameters ([#161](https://github.com/Laratypes/Laratype/issues/161)).
- Resolved: the 0.5 static `options` / `arguments` arrays are dropped as the source of the command's shape; the signature is the only source. They stay registered for existing 0.5 commands during the migration ([#161](https://github.com/Laratypes/Laratype/issues/161)).

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
- Resolved: jobs serialize models through the `BindableModel` interface (primary-key metadata), which S5 settles before the ORM is chosen ([#88](https://github.com/Laratypes/Laratype/issues/88)).

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
- Resolved: `lang/` sits at the project root ([overview.md › Project structure](./overview.md#project-structure), [#167](https://github.com/Laratypes/Laratype/issues/167)).

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
