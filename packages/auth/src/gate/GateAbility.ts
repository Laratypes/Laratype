/**
 * A gate: an ability with no model of its own, named and typed by `Gate.define()` (docs/v1/auth.md › Policies and
 * gates). `check()` resolves `true` only for an explicit `true` of the function, so anything else denies.
 */
export interface GateAbility<Args extends readonly unknown[] = readonly unknown[]> {

  /** The name of the gate, for diagnostics; it is not a lookup key. */
  readonly name: string;

  /** Runs the gate for `user`: `true` allows, `false` (or any non-`true` answer) denies. */
  readonly check: (user: unknown, ...args: Args) => Promise<boolean>;

}
