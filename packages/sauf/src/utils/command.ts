import { Command as Commander } from 'commander'
import {
  type AnyClosureCommand,
  type ArgumentType,
  type CommandClass,
  type ConsoleCommand,
  isClosureCommand,
  optionKey,
  overridesProviders,
  parseSignature,
  type ParsedSignature,
} from '@laratype/console'
import Transpile from './transplie'
import { resolveSync } from '@laratype/support'
import SignatureNotConfigYet from '../exceptions/SignatureNotConfigYet'

/**
 * Whether a command needs the app: `register()` (which imports the app's providers, routes and `$api`) and the
 * provider boot. A command opts out with `static bootsApp = false` (`types:generate` only reads files). A closure
 * command always boots the app.
 */
export const bootsApp = (command: ConsoleCommand): boolean =>
  isClosureCommand(command) || (command as { bootsApp?: boolean }).bootsApp !== false

const isClass = (command: ConsoleCommand): command is CommandClass => !isClosureCommand(command)

/**
 * A 0.5 command that filters the provider list itself (`db:*`, `route:list`, `auth:publish`, `make:*`). It is built
 * before the boot, so it keeps the 0.5 order; every other command is resolved by the container after `register()`.
 */
const filtersProviders = (command: CommandClass): boolean => overridesProviders(command)

/** `--class <class>` / `<names...>` -> `class` / `names`, so a signature never registers the same one twice. */
const legacyArgumentName = (name: string) =>
  name.replace(/^<|^\[/, '').replace(/>$|\]$/, '').replace(/\.\.\.$/, '').replace(/\?$/, '')

/** The camelCase key of a legacy `static.options` flags string (`'-p, --port <port>'` -> `port`). */
const legacyOptionKey = (flags: string): string | undefined => {
  const long = flags.match(/--([A-Za-z0-9-]+)/)
  return long ? optionKey(long[1]) : undefined
}

export default class Command {
  protected signature: string

  protected description: string | undefined

  protected commander: Commander | undefined

  protected commandInstance: CommandClass | undefined

  protected closure: AnyClosureCommand | undefined

  protected parsed: ParsedSignature

  protected transpiler: Transpile

  /** How many 0.5 `static.arguments` were registered before the signature's, to map commander's positional args. */
  protected legacyArguments = 0

  /** Where each input key comes from in commander's positional arguments (name, then index). */
  protected inputArguments: Array<{ name: string; index: number }> = []

  constructor(command: ConsoleCommand, transpiler: Transpile) {
    if (!command.signature) {
      throw new SignatureNotConfigYet()
    }
    this.commandInstance = isClass(command) ? command : undefined
    this.closure = isClosureCommand(command) ? command : undefined
    this.transpiler = transpiler
    this.signature = command.signature
    this.parsed = parseSignature(command.signature)
    this.description = isClosureCommand(command)
      ? this.parsed.description
      : command.description || this.parsed.description
    this.__initCommander()
  }

  protected __initCommander() {
    const commander = this.getCommander()

    if (this.description) commander.description(this.description)

    this.__registerLegacy()
    this.__registerSignature()

    commander.action(async (...args) => {
      await this.__run(commander, args)
    })
  }

  /** The 0.5 `static.options` / `static.arguments` arrays, registered before the signature's tokens. */
  protected __registerLegacy() {
    const commander = this.getCommander()

    this.commandInstance?.options?.forEach((options: string[]) => {
      const [flags, description, defaultValue] = options
      commander.option(flags, description, defaultValue)
    })

    this.commandInstance?.arguments?.forEach((arg: ArgumentType) => {
      commander.argument(arg.name, arg.description)
      this.inputArguments.push({ name: legacyArgumentName(arg.name), index: this.legacyArguments })
      this.legacyArguments += 1
    })
  }

  /** The signature's arguments and options, skipping a name a 0.5 static declaration already registered. */
  protected __registerSignature() {
    const commander = this.getCommander()
    const legacyArguments = new Set(
      (this.commandInstance?.arguments ?? []).map((arg: ArgumentType) => legacyArgumentName(arg.name))
    )
    const legacyOptions = new Set(
      (this.commandInstance?.options ?? [])
        .map((options: string[]) => legacyOptionKey(options[0]))
        .filter(Boolean)
    )

    let signatureArguments = 0
    for (const arg of this.parsed.arguments) {
      if (legacyArguments.has(arg.name)) continue
      const flags =
        arg.kind === 'required' ? `<${arg.name}>` : arg.kind === 'rest' ? `<${arg.name}...>` : `[${arg.name}]`
      commander.argument(flags, undefined, arg.kind === 'default' ? arg.default : undefined)
      this.inputArguments.push({ name: arg.name, index: this.legacyArguments + signatureArguments })
      signatureArguments += 1
    }

    for (const option of this.parsed.options) {
      if (legacyOptions.has(option.key)) continue
      const flags =
        option.kind === 'flag'
          ? `--${option.name}`
          : option.kind === 'rest'
            ? `--${option.name} <value...>`
            : `--${option.name} <value>`
      commander.option(flags, undefined, option.default)
    }
  }

  /** The typed input: argument names, then the camelCase option keys commander stored. */
  protected buildInput(args: unknown[]): Record<string, unknown> {
    const opts = this.getCommander().opts()
    const input: Record<string, unknown> = {}
    for (const { name, index } of this.inputArguments) {
      input[name] = args[index]
    }
    for (const option of this.parsed.options) {
      input[option.key] = opts[option.key]
    }
    return input
  }

  protected async __loadLaratype(): Promise<typeof import('laratype')> {
    const runner = await this.transpiler.getRunner()
    return await runner.ssrLoadModule(resolveSync('laratype')) as typeof import('laratype')
  }

  protected async __run(commander: Commander, args: unknown[]) {
    let downs: Array<() => Promise<void>> = []
    let failure: unknown
    let failed = false
    let result: unknown

    try {
      const input = this.buildInput(args)
      let instance: InstanceType<CommandClass> | undefined
      const legacyProviders = this.commandInstance !== undefined && filtersProviders(this.commandInstance)

      if (legacyProviders) {
        // 0.5 order: boot() runs before the providers, and the instance filters the provider list before the boot.
        // `dev` replaces the transpiler in boot(), so `laratype` is loaded only afterwards.
        instance = new this.commandInstance!()
        this.__prepare(instance, commander, input)
        await instance.boot(this.transpiler)
        // A legacy command that boots no app needs no `laratype` module at all (`types:generate`, `make:*`).
        if (bootsApp(this.commandInstance!)) {
          const laratype = await this.__loadLaratype()
          const providers = await laratype.register()
          downs = await laratype.bootProviders(laratype.Serve.getContainer(), await instance.providers(providers))
        }
      } else {
        const laratype = await this.__loadLaratype()
        if (bootsApp(this.closure ?? this.commandInstance!)) {
          downs = await laratype.bootProviders(laratype.Serve.getContainer(), await laratype.register())
        }
        if (this.commandInstance) {
          // Constructor DI (docs/v1/di.md): app commands are resolved by the container after the providers registered.
          instance = laratype.Serve.getContainer().make(this.commandInstance) as InstanceType<CommandClass>
          this.__prepare(instance, commander, input)
          await instance.boot(this.transpiler)
        }
      }

      result = this.closure ? await this.closure.handler(input) : await instance!.handle(...args)
    } catch (error) {
      failed = true
      failure = error
    }

    // Every cleanup runs, even when one throws: the command's error stays the one the caller sees.
    const cleanupErrors = await this.__cleanup(downs)
    if (failed) {
      for (const error of cleanupErrors) {
        console.error('[sauf] command cleanup failed after the command error', error)
      }
      throw failure
    }
    if (cleanupErrors.length) throw cleanupErrors[0]
    return result
  }

  protected async __cleanup(downs: Array<() => Promise<void>>): Promise<unknown[]> {
    const errors: unknown[] = []
    for (const down of downs) {
      try {
        await down()
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      await this.transpiler.close()
    } catch (error) {
      errors.push(error)
    }
    return errors
  }

  protected __prepare(instance: InstanceType<CommandClass>, commander: Commander, input: Record<string, unknown>) {
    instance.opts = commander.opts.bind(commander)
    instance.__setInput(input)
  }

  public getCommander() {
    return (this.commander ??= new Commander(this.parsed.name))
  }
}
