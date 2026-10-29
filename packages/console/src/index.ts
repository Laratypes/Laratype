import type Command from './command/Command'
import type { ArgumentType } from './command/Command'
import { type AnyClosureCommand, isClosureCommand } from './command/closure'

export { default as Console } from './support/Console'
export { default as Command, type ArgumentType, overridesProviders } from './command/Command'
export {
  CLOSURE_COMMAND,
  type AnyClosureCommand,
  type ClosureCommand,
  type ClosureHandler,
  command,
  isClosureCommand,
} from './command/closure'
export {
  type ArgumentName,
  type ArgumentValue,
  type CommandInput,
  CommandSignatureError,
  type OptionName,
  type OptionValue,
  type ParsedSignature,
  parseSignature,
  optionKey,
  type SignatureArgument,
  type SignatureOption,
} from './command/signature'

/** The static side of a `Command` class, as `sauf` registers it (any signature, the 0.5 shape included). */
export interface CommandClass {
  new (...args: any[]): Command<any>
  readonly prototype: Command<any>
  signature: string
  description?: string
  options?: string[][]
  arguments?: ArgumentType[]
  bootsApp?: boolean
}

/** What `sauf` registers from a command file or `app/routes/console.ts`: a `Command` class or a closure command. */
export type ConsoleCommand = CommandClass | AnyClosureCommand

/** Whether a value is something `sauf` can register as a command. */
export function isConsoleCommand(value: unknown): value is ConsoleCommand {
  if (typeof value === 'function') {
    return typeof (value as { signature?: unknown }).signature === 'string'
  }
  return isClosureCommand(value)
}
