import type { AbstractNewable } from "@laratype/core";
import { InternalException } from "@laratype/support";
import type { PromiseAble } from "@laratype/support";
import type { GateAbility } from "./GateAbility";
import GateManager, { describeValue } from "./GateManager";
import ForbiddenException from "../exceptions/ForbiddenException";
import { isUser } from "../support/guest";
import type {
  CheckPolicy,
  ModelPolicy,
  PolicyClass,
  SubjectAbility,
  SubjectArgs,
  SubjectParam,
} from "../policies/Policy";

/**
 * A gate value: the object `Gate.define()` returns, told from an ability name by its `check()`. `check` is read once,
 * and the function validated is the one called with the gate as its receiver: an accessor that answers a function on
 * the first read and `undefined` on the second cannot pass validation and then fail the call (#394).
 */
const asGate = (caller: string, ability: unknown): ((user: unknown, ...args: unknown[]) => unknown) => {
  const check = typeof ability === "object" && ability !== null ? (ability as { check?: unknown }).check : undefined;
  if (typeof check === "function") {
    return (user: unknown, ...args: unknown[]) => (check as (...params: unknown[]) => unknown).apply(ability, [user, ...args]);
  }
  throw new InternalException(
    `[@laratype/auth] ${caller}: the ability must be an ability name or a gate from Gate.define(), got ${describeValue(ability)}.`,
  );
};

/**
 * Policies and gates (#121, docs/v1/auth.md › Policies and gates). The 0.5 abstract gate base is unchanged: a class
 * extending `Gate` keeps its `handle()`. v1 checks are static:
 * - `Gate.policy(Model, Policy)` registers a policy in a service provider;
 * - `Gate.allows()`, `Gate.denies()` and `Gate.authorize()` run an ability of the subject's policy, or a gate;
 * - `Gate.define()` builds a typed gate for an ability with no model of its own.
 */
export default abstract class Gate {

  abstract handle(...args: any): boolean;

  /** Registers `policy` for `model` (typically in a service provider's `register()`); a model has one policy. */
  static policy<M extends object>(
    model: AbstractNewable<M>,
    policy: [ModelPolicy<M>] extends [never] ? PolicyClass : AbstractNewable<ModelPolicy<M>>,
  ): void {
    GateManager.current().policy(model, policy as PolicyClass);
  }

  /** Whether `user` may `ability` on `subject`, as its registered policy decides (docs/v1/auth.md › Public API). */
  static allows<M, K extends SubjectAbility<M>, A extends SubjectArgs<M, K> & unknown[]>(
    user: unknown,
    ability: K,
    subject: M & CheckPolicy<M> & SubjectParam<M, K>,
    ...args: A
  ): Promise<boolean>;
  static allows<Args extends readonly unknown[]>(
    user: unknown,
    ability: GateAbility<Args>,
    ...args: Args
  ): Promise<boolean>;
  static async allows(user: unknown, ability: unknown, ...rest: unknown[]): Promise<boolean> {
    // A guest denies, and a gate is not asked about a user it was not written for
    if (!isUser(user)) return false;
    if (typeof ability === "string") {
      const [subject, ...args] = rest;
      return GateManager.current().allows(user, ability, subject, ...args);
    }
    // Only an explicit true allows, as Gate.define() and the policy checks do: a hand-built gate's truthy value,
    // object or promise of one denies (#394)
    return (await asGate("Gate.allows", ability)(user, ...rest)) === true;
  }

  /** The inverse of `allows()`: `true` only when the policy or gate denies. */
  static denies<M, K extends SubjectAbility<M>, A extends SubjectArgs<M, K> & unknown[]>(
    user: unknown,
    ability: K,
    subject: M & CheckPolicy<M> & SubjectParam<M, K>,
    ...args: A
  ): Promise<boolean>;
  static denies<Args extends readonly unknown[]>(
    user: unknown,
    ability: GateAbility<Args>,
    ...args: Args
  ): Promise<boolean>;
  static async denies(user: unknown, ability: unknown, ...rest: unknown[]): Promise<boolean> {
    if (!isUser(user)) return true;
    if (typeof ability !== "string") {
      return (await asGate("Gate.denies", ability)(user, ...rest)) !== true;
    }
    const [subject, ...args] = rest;
    return GateManager.current().denies(user, ability, subject, ...args);
  }

  /** Runs the check and throws `ForbiddenException` (403) unless it allows. */
  static authorize<M, K extends SubjectAbility<M>, A extends SubjectArgs<M, K> & unknown[]>(
    user: unknown,
    ability: K,
    subject: M & CheckPolicy<M> & SubjectParam<M, K>,
    ...args: A
  ): Promise<void>;
  static authorize<Args extends readonly unknown[]>(
    user: unknown,
    ability: GateAbility<Args>,
    ...args: Args
  ): Promise<void>;
  static async authorize(user: unknown, ability: unknown, ...rest: unknown[]): Promise<void> {
    if (!isUser(user)) throw new ForbiddenException();
    if (typeof ability === "string") {
      const [subject, ...args] = rest;
      return GateManager.current().authorize(user, ability, subject, ...args);
    }
    if ((await asGate("Gate.authorize", ability)(user, ...rest)) !== true) {
      throw new ForbiddenException();
    }
  }

  /**
   * Builds a gate: `const UpdatePost = Gate.define("update-post", (user, post) => user.id === post.userId)`, checked
   * with `Gate.allows(user, UpdatePost, post)`. Arguments after the user are typed from `fn`.
   */
  static define<Args extends readonly unknown[]>(
    name: string,
    fn: (user: any, ...args: Args) => PromiseAble<boolean | null>,
  ): GateAbility<Args> {
    if (typeof name !== "string" || name === "") {
      throw new InternalException(
        `[@laratype/auth] Gate.define: the name must be a non-empty string, got ${describeValue(name)}.`,
      );
    }
    if (typeof fn !== "function") {
      throw new InternalException(`[@laratype/auth] Gate.define: the gate must be a function, got ${describeValue(fn)}.`);
    }
    return Object.freeze({
      name,
      // A guest denies without the gate running, as Gate.allows()/authorize() do (docs/v1/auth.md › Invariants)
      async check(user: unknown, ...args: Args): Promise<boolean> {
        if (!isUser(user)) return false;
        // Only an explicit true allows, as the policy checks do: a truthy value or an undefined return denies
        return (await fn(user, ...args)) === true;
      },
    });
  }

}
