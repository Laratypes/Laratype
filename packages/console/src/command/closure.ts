import type { CommandInput } from "./signature";

/** Marks a closure command across package copies (`sauf` and the app may load different bundles). */
export const CLOSURE_COMMAND: unique symbol = Symbol.for("laratype.console.closure");

export type ClosureHandler<S extends string> = (input: CommandInput<S>) => unknown | Promise<unknown>;

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
  readonly description?: string;
  readonly handler: ClosureHandler<S>;
}

export function command<S extends string>(signature: S, handler: ClosureHandler<S>): ClosureCommand<S>;
export function command<S extends string>(signature: S, description: string, handler: ClosureHandler<S>): ClosureCommand<S>;
export function command<S extends string>(
  signature: S,
  descriptionOrHandler: string | ClosureHandler<S>,
  maybeHandler?: ClosureHandler<S>,
): ClosureCommand<S> {
  const description = typeof descriptionOrHandler === "string" ? descriptionOrHandler : undefined;
  const handler = typeof descriptionOrHandler === "function" ? descriptionOrHandler : maybeHandler;
  if (handler === undefined) throw new TypeError("command(signature, handler): the handler is missing");
  return { [CLOSURE_COMMAND]: true, signature, description, handler };
}

/** Whether a value is a closure command (`command(...)`), as opposed to a `Command` class. */
export function isClosureCommand(value: unknown): value is ClosureCommand<any> {
  return typeof value === "object" && value !== null && (value as { [CLOSURE_COMMAND]?: unknown })[CLOSURE_COMMAND] === true;
}
