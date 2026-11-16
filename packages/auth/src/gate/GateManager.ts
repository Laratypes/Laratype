import { Facade } from "@laratype/core";
import type { AbstractNewable, Container } from "@laratype/core";
import { ContextApi, InternalException } from "@laratype/support";
import type { PolicyClass } from "../policies/Policy";
import { policyAllows, policyAuthorize } from "../policies/authorize";
import ForbiddenException from "../exceptions/ForbiddenException";

/** How a value shows in a diagnostic: `<class Foo>`, `undefined`, `null`, `object`, ... */
export const describeValue = (value: unknown): string =>
  typeof value === "function" ? `<${value.name || "anonymous class"}>` : value === null ? "null" : typeof value;

/**
 * The policy registry and checks behind `Gate` (#121, docs/v1/auth.md › Policies and gates): `Gate.policy()` records a
 * model class -> policy class, and `Gate.allows()` resolves one by the subject's own class. A singleton in the current
 * request's container, else the facade application, as `ModelBindingRegistry` does (docs/v1/di.md › Container-backed
 * registries and facades).
 */
export default class GateManager {

  protected readonly policies = new Map<AbstractNewable<object>, PolicyClass>();

  /** Registers `policy` for `model`: `Gate.policy(Post, PostPolicy)`, from a service provider's `register()` or `boot()`. */
  policy<M extends object>(model: AbstractNewable<M>, policy: PolicyClass): this {
    if (typeof model !== "function" || model.prototype === undefined) {
      throw new InternalException(`[@laratype/auth] Gate.policy: the model must be a class, got ${describeValue(model)}.`);
    }
    if (typeof policy !== "function" || policy.prototype === undefined) {
      throw new InternalException(`[@laratype/auth] Gate.policy: the policy must be a class, got ${describeValue(policy)}.`);
    }
    const registered = this.policies.get(model);
    if (registered === policy) return this;
    if (registered) {
      throw new InternalException(
        `[@laratype/auth] ${model.name} already has the policy ${registered.name}; a model has one policy (register it once).`,
      );
    }
    this.policies.set(model, policy);
    return this;
  }

  /**
   * The policy registered for `subject`, by its class: an instance uses its own class and a class is used as is. Exact
   * class only, no parent walk: a subclass needs its own `Gate.policy()` (docs/v1/auth.md › Invariants).
   */
  policyFor(subject: unknown): PolicyClass | undefined {
    const model = typeof subject === "function"
      ? subject
      : subject !== null && typeof subject === "object" ? (subject as object).constructor : undefined;
    if (typeof model !== "function") return undefined;
    return this.policies.get(model as AbstractNewable<object>);
  }

  /** Whether `user` may run `ability` on `subject`: a guest denies without the policy running, a missing policy throws. */
  allows(user: unknown, ability: string, subject: unknown, ...args: unknown[]): Promise<boolean> {
    // A guest never reaches a policy: a policy written for a signed-in user must not decide on `undefined`
    if (user === undefined || user === null) return Promise.resolve(false);
    return policyAllows(this.instance("Gate.allows", subject), user, ability, subject, ...args);
  }

  /** The inverse of `allows()`: `true` only when the check does not allow. */
  async denies(user: unknown, ability: string, subject: unknown, ...args: unknown[]): Promise<boolean> {
    return !(await this.allows(user, ability, subject, ...args));
  }

  /** Runs the check and throws the derived 403 unless it allows: `policyAuthorize()` of the subject's policy. */
  async authorize(user: unknown, ability: string, subject: unknown, ...args: unknown[]): Promise<void> {
    if (user === undefined || user === null) throw new ForbiddenException();
    await policyAuthorize(this.instance("Gate.authorize", subject), user, ability, subject, ...args);
  }

  /**
   * The policy instance of `subject`, built by the container so constructor injection works (H21 #269): the request's
   * container, else the facade application. A missing policy is a configuration error, never a silent allow.
   */
  protected instance(caller: string, subject: unknown): object {
    const policy = this.policyFor(subject);
    if (policy) return GateManager.container().make(policy);
    const model = typeof subject === "function" ? subject.name : (subject as { constructor?: { name?: string } } | null)
      ?.constructor?.name;
    const name = model || describeValue(subject);
    throw new InternalException(
      `[@laratype/auth] ${caller}: no policy is defined for ${name}.`
      + ` Fix: register it with Gate.policy(${name}, <Policy>) in a service provider.`,
    );
  }

  /** The registry of the current request's container, else the facade application's; bound on first use, as D7's registries. */
  static current(): GateManager {
    const container = GateManager.container();
    if (!container.has(GateManager)) {
      container.singleton(GateManager);
    }
    return container.make(GateManager);
  }

  /** The container `current()` resolves from: the current request's scope, else the facade application. */
  static container(): Container {
    return ContextApi.getContainer() ?? Facade.getFacadeApplication();
  }

}
