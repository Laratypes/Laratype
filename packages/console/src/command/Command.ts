import { AppServiceProvider, ServiceProvider } from "@laratype/support";
import {
  type ArgumentName,
  type ArgumentValue,
  type CommandInput,
  type OptionName,
  type OptionValue,
  optionKey,
} from "./signature";

/** A 0.5-style argument declaration (`static arguments`), kept for commands written before typed signatures. */
export type ArgumentType = {
  name: string;
  description?: string;
};

/**
 * Marks the base `providers()` method. `sauf` and the app may each load their own copy of this module, so a
 * prototype comparison would mistake the two base methods for an override; the shared symbol survives both copies.
 */
const DEFAULT_PROVIDERS: unique symbol = Symbol.for("laratype.console.defaultProviders");

/**
 * Base class of app commands (docs/v1/services.md › Console commands).
 *
 * The signature is the single source of the command name, its arguments and its options:
 * `static readonly signature = "send:mail {user} {--queue=}" as const`. Pass its type to `Command` so
 * `this.argument("user")` and `this.option("queue")` are typed:
 *
 * ```ts
 * export default class SendMail extends Command<typeof SendMail.signature> {
 *   static readonly signature = "send:mail {user} {--queue=}" as const
 *   handle() {
 *     this.argument("user")  // string
 *     this.option("queue")   // string | undefined
 *   }
 * }
 * ```
 *
 * `sauf` resolves the command through the container, so constructor injection works without decorators. A
 * signature that is not a literal (`string`, as in every 0.5 command) keeps the methods loosely typed.
 */
export default class Command<S extends string = string> {
  static signature: string;

  static description?: string;

  /** 0.5 declarations, registered next to the signature while commands migrate. New commands only use the signature. */
  static options: string[][] | undefined;

  /** 0.5 declarations, registered next to the signature while commands migrate. */
  static arguments: ArgumentType[] | undefined;

  /**
   * Whether the command needs the app (`register()` plus the provider boot). A command that only reads files or
   * writes stubs sets it to `false`; a closure command always boots the app.
   */
  static bootsApp?: boolean;

  protected __input: Record<string, unknown> | undefined;

  public opts(): any {
    return undefined;
  }

  /** The value of the signature argument `name`; the wrapper fills it from commander before `handle()`. */
  public argument<Name extends ArgumentName<S>>(name: Name): ArgumentValue<S, Name> {
    return this.__input?.[String(name)] as ArgumentValue<S, Name>;
  }

  /** The value of the signature option `name` (its flag without the dashes); `--dry-run` is `option("dry-run")`. */
  public option<Name extends OptionName<S>>(name: Name): OptionValue<S, Name> {
    return this.__input?.[optionKey(String(name))] as OptionValue<S, Name>;
  }

  /** Filled by `sauf` before `handle()`. Arguments keep their names; option keys are camelCase (`--dry-run`). */
  public __setInput(input: CommandInput<S>): void {
    this.__input = input as Record<string, unknown>;
  }

  public async boot(...args: any[]) {
    // Implement boot logic here
  }

  public handle(...args: any[]) {
    // Implement your command logic here
  }

  public async providers(providers: Array<typeof AppServiceProvider | typeof ServiceProvider>) {
    // Implement filtering logic here
    return providers;
  }
}

Object.defineProperty(Command.prototype.providers, DEFAULT_PROVIDERS, { value: true });

/**
 * Whether a command class overrides `providers()` (the 0.5 commands that filter the provider list before the boot).
 * Works across copies of `@laratype/console`: each copy marks its own base method with the same symbol.
 */
export function overridesProviders(command: { prototype: object }): boolean {
  const providers = (command.prototype as { providers?: unknown }).providers;
  return typeof providers !== "function" || (providers as unknown as Record<symbol, unknown>)[DEFAULT_PROVIDERS] !== true;
}
