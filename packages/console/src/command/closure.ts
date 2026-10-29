import type { CommandInput } from "./signature";

/** Marks a closure command across package copies (`sauf` and the app may load different bundles). */
export const CLOSURE_COMMAND: unique symbol = Symbol.for("laratype.console.closure");

/** What a closure command's handler receives: one object typed from the signature. */
export type ClosureHandler<S extends string = string> = (input: CommandInput<S>) => unknown | Promise<unknown>;

/**
 * A command declared in `app/routes/console.ts` with `command(signature, handler)` (docs/v1/services.md › Console
 * commands). `sauf` registers it like a class command; the handler receives one input object, typed from the
 * signature:
 *
 * ```ts
 * command("send:mail {user} {--queue=}", ({ user, queue }) => {
 *   user  // string
 *   queue // string | undefined
 * })
 * ```
 */
export interface ClosureCommand<S extends string = string> {
  readonly [CLOSURE_COMMAND]: true;
  readonly signature: S;
  readonly handler: ClosureHandler<S>;
}

/** A closure command whose signature type is not known, for the registration helpers. */
export type AnyClosureCommand = ClosureCommand<any>;

/** Declares a closure command; the ` : description` part of the signature is its description. */
export function command<S extends string>(signature: S, handler: ClosureHandler<S>): ClosureCommand<S> {
  return { [CLOSURE_COMMAND]: true, signature, handler };
}

/** Whether a value is a closure command (`command(...)`), as opposed to a `Command` class. */
export function isClosureCommand(value: unknown): value is AnyClosureCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [CLOSURE_COMMAND]?: unknown })[CLOSURE_COMMAND] === true
  );
}
