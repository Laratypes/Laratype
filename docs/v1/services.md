---
area: services
packages: ["@laratype/core", "@laratype/console", "@laratype/log", "@laratype/cache", "@laratype/storage", "@laratype/queue", "@laratype/mail", "@laratype/i18n", "@laratype/schedule", "@laratype/broadcast", "@laratype/contract", "@laratype/client"]
issues: [115, 158, 160, 161, 165, 166, 167, 168, 169, 170, 171, 175, 176, 177, 178]
verified-against: Laratype@256a743 (0.5 state also checked on v0.5.4 @ 053be38; + F2 console commands at fc9b54d)
last-verified: 2026-11-08
---

# Services

The application services: the driver `Manager`, console commands, events, cache, storage, queues, mail, localization, the scheduler, processes and broadcasting.

> **Planned, except the driver Manager, console commands and Localization.** The [Driver Manager](#driver-manager) is proposed in PR [#355](https://github.com/Laratypes/Laratype/pull/355), [Console commands](#console-commands) is proposed by F2 [#161](https://github.com/Laratypes/Laratype/issues/161) in PR [#357](https://github.com/Laratypes/Laratype/pull/357), and [Localization](#localization) is proposed by I1 [#167](https://github.com/Laratypes/Laratype/issues/167) in PR [#361](https://github.com/Laratypes/Laratype/pull/361). Every other section is `planned → #N`. A planned section holds a **Design (non-binding)** note built from the issue bodies, and a name in backticks is the name its issue uses; where the issue does not state a signature, it is not settled. A planned section leaves Public API, Invariants, Diagnostics and Example out until its code merges ([README](./README.md)).

**State on master (0.5):** checked on `256a743`. The same files are unchanged on `v0.5.4`.
- `@laratype/console` has a `Command` base class with static `signature`, `description`, `options` and `arguments` and a `handle()` method ([`Command.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/console/src/command/Command.ts#L1-L34)). sauf loads app commands from `app/src/console/commands/*.ts` and from the default export of `app/routes/console.ts` ([`sauf/src/utils/index.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/utils/index.ts#L10-L34)).
- `@laratype/log` has a `Logger` on winston. The config type allows the channels `"stack" | "single" | "daily"` ([`Config.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/contracts/Config.ts#L33-L53)), but only `single` is implemented. Any other channel throws `DriverNotImplement` ([`Logger.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/log/src/Logger.ts#L29-L36)).
- `packages/mail`, `storage`, `schedule` and `broadcast` contain only `package.json`; `packages/i18n` is the proposed I1 package.
- There is no events, cache, queue or process package.

| Section | Status |
|---|---|
| [Shared service rules](#shared-service-rules) | planned → #160, #115, #158, #165 |
| [Driver Manager](#driver-manager) | proposed: PR [#355](https://github.com/Laratypes/Laratype/pull/355) @ 635c453 |
| [Console commands](#console-commands) | proposed: PR [#357](https://github.com/Laratypes/Laratype/pull/357) @ fc9b54d (F2 [#161](https://github.com/Laratypes/Laratype/issues/161)) |
| [Events and listeners](#events-and-listeners) | planned → #165 |
| [Cache](#cache) | planned → #166 |
| [Storage](#storage) | planned → #168 |
| [Queue](#queue) | planned → #169 |
| [Job chains and batches](#job-chains-and-batches) | planned → #175 |
| [Mail](#mail) | planned → #170 |
| [Localization](#localization) | proposed: PR [#361](https://github.com/Laratypes/Laratype/pull/361) @ 3bddf36 |
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
- **Container-created classes:** listeners, jobs, mailables and commands are created by the container (`app.make()`), so constructor DI works without decorators ([di.md › Dependency metadata](./di.md#dependency-metadata)). A command that overrides `providers()` is the exception ([Console commands](#console-commands)).
- **Jobs:** a job's constructor holds the payload, and `handle()` receives its dependencies by method injection ([di.md › Method injection](./di.md#method-injection)).
- **Listener discovery:** the DI transform reads `handle(event: X)` to register a listener for event `X` automatically ([Events and listeners](#events-and-listeners)).

### Acceptance
Each service's own issue, linked in its section.

---

## Driver Manager

### Status
proposed: PR [#355](https://github.com/Laratypes/Laratype/pull/355) @ 635c453 ([#160](https://github.com/Laratypes/Laratype/issues/160), F1, M3). Depends on D1 [#96](https://github.com/Laratypes/Laratype/issues/96), D8 [#115](https://github.com/Laratypes/Laratype/issues/115), K1 [#152](https://github.com/Laratypes/Laratype/issues/152).

### Public API
`Manager` lives in [`packages/core/src/manager.ts` @ 635c453](https://github.com/Laratypes/Laratype/blob/635c453/packages/core/src/manager.ts) and is exported by `@laratype/core`; the log port is [`LogManager` @ 7bd86c1](https://github.com/Laratypes/Laratype/blob/7bd86c1/packages/log/src/support/Log.ts).

```ts
// @laratype/core
export type DriverMap = Record<string, object>

export abstract class Manager<
  Drivers extends DriverMap,
  Default extends keyof Drivers & string = keyof Drivers & string,
> {
  protected abstract get defaultDriver(): Default
  protected abstract createDriver(name: keyof Drivers & string): Drivers[keyof Drivers]
  driver(): Drivers[Default]
  driver<K extends keyof Drivers & string>(name: K): Drivers[K]
  extend<K extends keyof Drivers & string>(name: K, factory: (manager: this) => Drivers[K]): this
}
```

### Invariants
- **Resolution:** `driver(name)` returns the driver a config key names, built with `extend()`'s factory when one is registered for that name, else with `createDriver()`; the instance is cached by name, so later calls return the same object unless the build replaced its factory through `extend()` (see Construction). `driver()` without a name resolves `defaultDriver`, which each service reads from the `default` key of its config file (K1). A service without a default driver throws from `defaultDriver`.
- **Typing:** `Drivers` maps each name the service config declares (log channels, cache stores, mail mailers, ...) to its driver type, and `Default` is the type of the config's `default` (a literal from a `defineConfig` file; for log, the `LaratypeConfig.Logging.Config["default"]` union). `driver()` is typed as the default driver, `driver(name)` as the named one (two overloads, so neither `driver<'memory'>()` nor a name that may be `undefined` types the default driver as a named one), and a name outside `Drivers` is a type error (see Diagnostics). `Drivers` is required, so a subclass cannot omit it (bare `Manager` does not compile); it bounds the names when its keys are finite, and a manager that passes `Record<string, Store>` still accepts any string.
- **extend():** replaces the factory of a name the service config declares, for a custom driver or a test double, and drops that name's cached instance so the next `driver(name)` call builds it with the new factory. Unlike Laravel, it does not add a driver name: a custom driver is declared in the config first. Only the type checks the name: at run time `extend()` stores any name, and `driver(name)` returns that factory's driver without consulting `createDriver()`.
- **Construction:** a driver is cached only when the factory registered for its name is unchanged after the build: if `createDriver()` or an `extend()` factory replaces the factory of its own name through `extend()` while it runs, `driver(name)` returns that build's driver without caching it, and the next call builds with the replacement.
- **Facades:** a service manager (e.g. `LogManager`) is a facade accessor, so the service facade's `fake()` (D8) — `Log.fake(manager)` — swaps it in the facade application and the next call resolves the fake, with its own cache. There is no separate driver-level fake. A provider binds a service manager as a singleton, so its per-name cache lives as long as the container; log has no provider yet, so `Log.root()` autowires a fresh `LogManager` per call and its per-name cache is per instance, while the `single` file transport stays per process (`LogManager.logger` is static).
- **Log:** `LogManager extends Manager<ChannelDrivers, LaratypeConfig.Logging.Config["default"]>`, with `ChannelDrivers = { [C in LaratypeConfig.Logging.CHANNEL]: Logger }`. `single` builds the 0.5 winston `Logger` with its static per-process cache ([di.md › Container-backed registries and facades](./di.md#container-backed-registries-and-facades)), `stack` and `daily` throw the 0.5 `DriverNotImplement`, and `getLogger()` returns `driver()`, so `logging.default` picks the channel. `Logger` no longer holds a channel: it is the `single` channel the manager builds.

### Diagnostics
- Runtime: a service's `createDriver()` throws for a name it does not support. Log keeps 0.5's `DriverNotImplement` object (code `DRIVER_NOT_IMPLEMENT`, message `Driver not implemented`) for `stack`, `daily` and a missing `logging.default`.
- Type-only (`core/__tests__/manager.test-d.ts`): an unknown driver name fails with TS2345, the parameter being the union of the manager's names:
  ```
  error TS2345: Argument of type '"nope"' is not assignable to parameter of type '"single" | "memory"'.
  ```
  `extend()` takes only a declared name, and its factory must return that driver's type.

### Example
[`examples/services/proposed/manager.ts`](./examples/services/proposed/manager.ts).

### Non-goals
- No driver-level fake and no `fake()` on the manager: the service facade's `fake()` (`Log.fake(manager)`) swaps the whole service manager.
- No `forget()` or cache-reset API beyond `extend()` dropping one name.
- No runtime check that a name is in `Drivers`: the type is the check, and a name with no factory reaches `createDriver()`.

### Open questions
- Resolved: driver names come from the config type (Q16): the app registers its config files with `declare module '@laratype/core'` (K1), and a service manager types `Drivers` from the keys of its config, `Default` from the config's `default` (log: the 0.5 `LaratypeConfig.Logging.Config["default"]` union; the v1 services: the literal in their `app/config/*.ts` file) ([#160](https://github.com/Laratypes/Laratype/issues/160), [#222](https://github.com/Laratypes/Laratype/issues/222)).

### Acceptance
[#160 Done when](https://github.com/Laratypes/Laratype/issues/160)

---

## Console commands

### Status
proposed: PR [#357](https://github.com/Laratypes/Laratype/pull/357) @ fc9b54d ([#161](https://github.com/Laratypes/Laratype/issues/161), F2, M3). Depends on D4 #99, B1 #125, T2 #102.

The 0.5 static `options` / `arguments` arrays stay registered for commands that already declare them, but the signature is the only source of the typed name, arguments and options. Dropping the arrays is the breaking change recorded on [#161](https://github.com/Laratypes/Laratype/issues/161).

### Public API

The types live in [`signature.ts` @ fc9b54d](https://github.com/Laratypes/Laratype/blob/fc9b54de55522abd02fe7a917bf229adce3d4528/packages/console/src/command/signature.ts), [`Command.ts` @ fc9b54d](https://github.com/Laratypes/Laratype/blob/fc9b54de55522abd02fe7a917bf229adce3d4528/packages/console/src/command/Command.ts), [`closure.ts` @ fc9b54d](https://github.com/Laratypes/Laratype/blob/fc9b54de55522abd02fe7a917bf229adce3d4528/packages/console/src/command/closure.ts), the parse error in [`CommandSignatureError.ts` @ fc9b54d](https://github.com/Laratypes/Laratype/blob/fc9b54de55522abd02fe7a917bf229adce3d4528/packages/console/src/command/CommandSignatureError.ts) and the registration in [`sauf/src/utils/command.ts` @ fc9b54d](https://github.com/Laratypes/Laratype/blob/fc9b54de55522abd02fe7a917bf229adce3d4528/packages/sauf/src/utils/command.ts).

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

An argument name or option flag starts with a letter or `_`, then letters, digits, `_` or `-`. An option keeps one dash between its segments (no leading, trailing or doubled dash), because commander camelCases it: `{--dry-run}` is the input key `dryRun`, while `this.option("dry-run")` takes the flag as written. Every segment after a dash starts with a letter or digit, and a flag name cannot start with `no-`: commander treats `--no-cache` as the negation of `cache` and stores the value under `cache`, so declare `{--cache}` and let the handler decide what absence means.

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
- `parseSignature()` throws `CommandSignatureError: Invalid command signature "<signature>": <reason>`. The reasons are: `the signature is empty`, `"<name>" is not a valid command name`, `"<token>" is neither an argument nor an option: wrap it in { }`, `"--<body>" is not a valid option name`, `"--<name>" uses negation, which is not supported: declare {--<flag>} as a flag instead`, `"<body>" is not a valid argument name`, `"<token>" uses a short option: use a long --option instead`, and `"<key>" is declared twice`. An empty `static signature` is rejected by `sauf` before parsing, with `COMMAND_SIGNATURE_NOT_CONFIG_YET` and `Command signature not configured yet`.
- A command file whose default export is not a command class: `Skipped <files>: the default export is not a command class (a class with a static signature)`.
- A non-command entry in the route file: `Skipped <N> entries of app/routes/console.ts: not a command (a class with a static signature, or a closure from command())` (`entry` when `N` is 1). A defined default export that is not an array gives `Skipped app/routes/console.ts: the default export is not an array of commands`.
- Constructor DI in a production `dist/cli.js` fails with `Cannot autowire <Class>: its constructor takes N param(s) but no dependency metadata was found.` The DI transform runs in `sauf dev` only ([build.md › Plugin chain](./build.md#plugin-chain)).
- Two commands with one name (a command file reusing `route:list`, say): `Duplicate command "<name>": <source> and <source> register it. Fix: rename one.`. A source is `a framework command`, `a command file` or `app/routes/console.ts`; the check runs before commander's own `cannot add command … as already have command …` error.
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
proposed: PR [#361](https://github.com/Laratypes/Laratype/pull/361) @ 3bddf36 (I1, M3, `@laratype/i18n`). Depends on K1 #152, B1 #125, D6 #112, C3 #91.

### Public API
The API lives in [`index.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/index.ts), with `defineLang` in [`define-lang.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/define-lang.ts), `Locale` in [`locale.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/locale.ts), `Translator` in [`translator.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/translator.ts), `Lang` in [`lang.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/lang.ts), the helpers in [`functions.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/functions.ts), `LocaleMiddleware` in [`locale-middleware.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/locale-middleware.ts), `I18nServiceProvider` in [`i18n-service-provider.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/i18n-service-provider.ts), `I18nError` in [`errors.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/errors.ts), `validationMessage` in [`validation.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/validation.ts), `loadMessages` and `LangCatalog` in [`catalog.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/catalog.ts), and the types in [`types.ts` @ 3bddf36](https://github.com/Laratypes/Laratype/blob/3bddf3668ef783469547c8339e3d6d5b5228029f/packages/i18n/src/types.ts).

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
// The arguments after the key: any params before the app registers its tree, no params when the message has no
// placeholders (`trans(key)` or `trans(key, undefined, "vi")`), a required params object otherwise, plus an optional locale.
export type TransArgs<K extends string = LangKey> = string extends LangKey
  ? [params?: MessageParams, locale?: string]
  : keyof TransParams<K> extends never
    ? [params?: undefined, locale?: string]
    : [params: TransParams<K>, locale?: string]
export type MessageParams = Record<string, string | number>
export type LangCatalog = Readonly<Record<string, Readonly<Record<string, LangTree>>>>
export interface TranslatorOptions { locale?: string; fallbackLocale?: string }
```

**Config:** `app/config/i18n.ts` default-exports `defineConfig({ locale, fallback_locale })`, read as `config("i18n.locale")` / `config("i18n.fallback_locale")`. Without it, the 0.5 single config file's `config.locale` / `config.fallback_locale` are read; a locale that is still unset defaults to `en`, and the fallback defaults to the default locale.

**Manifest:** `AppManifest.lang` is the `lang` kind: one entry per `lang/<locale>/<file>.ts`, named `<locale>/<file>` (build.md › manifest). The build tsconfig must include `lang/**/*`: a lang file outside the build program is left out of `dist/app.manifest.js`, and `sauf build` warns that production has no translations for it (`trans()` then returns raw keys).

### Invariants
- **Keys** are `<file>.<dotted key>` (`messages.greeting`, `validation.required`). A registered `Register.lang` makes an unknown key, a missing placeholder param and an extra param type errors. `"Hello {name}"` takes `{ name: string }`; a `{count}` placeholder and every plural take `{ count: number }`. The extra-param check is an excess-property check, so it applies to an object literal only: a params object passed through a variable may carry extra keys and still type-check. Key typing uses the K1/Q16 module-augmentation pattern; generating it from the manifest is a follow-up. A file name or a key segment cannot contain `.`: lookup splits the key on dots, so `loadMessages()` rejects one with `I18nError`. A file root is always a container (`messages.one`, `messages.other`), never a plural leaf; a plural object below the root is a leaf.
- **Plurals** are a leaf object whose keys are all `Intl.PluralRules` categories (`zero|one|two|few|many|other`, `other` required); `Intl.PluralRules` selects the form from `params.count`. The locale is normalized before the rules are built, so a `fr_FR` folder uses the French rules.
- **Matching and fallback:** a locale matches exactly, then by base language (`en-US` → `en`), then by another region of the same language (`en` → `en-US`); `LocaleMiddleware` and the catalog lookup use the same matching. A message is looked up in every catalog match of the requested tag in that order (so `en-GB` tries `en`, then `en-US`), then in every match of `fallback_locale`, without repeating a locale; when no locale has it, the key itself is returned. A missing key never throws.
- **Locale per request (D6):** `Locale` is request-scoped; `LocaleMiddleware` reads `?locale=`, then the authenticated user's `locale`, then the `Accept-Language` q-list, then leaves the app default. Only locales with a catalog (plus the default and fallback) are accepted, and `?locale=` wins. A header tag with `q=0` is an exclusion: a catalog locale it names exactly is never chosen from the header, and when the first match of a range is excluded the range's other matches are still tried before the next range. A range with a malformed `q` (empty, non-numeric, outside `0..1`, or more than three decimals) is skipped: it is neither an exclusion nor `q=1`. Register the middleware after the auth middleware, or the user preference is not set yet. Outside a request, `setLocale()` changes the translator default (CLI, queued jobs); inside a request with no request container (a route not served through `RequestKernel`) it leaves the shared default unchanged and warns once in dev, so it cannot leak into later requests.
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
- Type errors, checked against `Register.lang` (the `trans` / `__` type test): an unknown key fails with TS2345, a missing params object with TS2554, a wrong placeholder type with TS2322 and an extra literal param with TS2353.
  ```
  error TS2345: Argument of type '"messages.missing"' is not assignable to parameter of type '"messages.greeting" | "messages.apples" | "messages.plain" | "messages.nested.farewell"'.
  error TS2554: Expected 2-3 arguments, but got 1.
  error TS2322: Type 'number' is not assignable to type 'string'.
  error TS2353: Object literal may only specify known properties, and 'extra' does not exist in type '{ name: string; }'.
  ```
  The key union in the first message is the test file's registered keys; an app's message names its own. The TS2353 error is an excess-property check, so only an object literal fails it: a params object passed through a variable may carry extra keys without an error.

### Example
```ts
// app/declare/i18n.d.ts
import messages from "../../lang/en/messages"
declare module "@laratype/i18n" { interface Register { lang: { messages: typeof messages } } }

// controller
import { __ } from "@laratype/i18n"

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
