import type { PromiseAble } from "@laratype/support";

export type Ability = Exclude<keyof Policy, 'before'>;

/**
 * A policy class (v1): any class whose methods are the abilities, with an optional `before`
 * (docs/v1/auth.md › Policies and gates).
 */
export type PolicyClass = abstract new (...args: any[]) => object;

/**
 * The abilities of policy `P`: its string method names, minus `before` (docs/v1/auth.md › Policies and gates). A field
 * that is not a method is not an ability, as in the router's policy proof
 * (docs/v1/http.md › Route proof at r.contract()).
 */
export type PolicyAbility<P> = Exclude<Extract<{
  [K in keyof P]-?: P[K] extends (...args: any[]) => any ? K : never
}[keyof P], string>, "before">;

/** Every parameter of an ability after the user. */
type PolicyParams<P, K extends PolicyAbility<P>> =
  P[K] extends (user: any, ...params: infer R) => any ? R : never;

/**
 * The arguments an ability takes after the subject: `update(user, post)` gives `[]` and `share(user, post, target)`
 * gives `[target: User]`. The subject is the ability's first parameter, always passed by `Gate.allows()`.
 */
export type PolicyArgs<P, K extends PolicyAbility<P>> =
  PolicyParams<P, K> extends [subject: any, ...args: infer A] ? A : [];

/**
 * The subject parameter of an ability: `update(user, post)` and `share(user, post, target)` give `Post`, while an
 * ability with no model of its own (`viewAny(user)`) gives `never` (docs/v1/auth.md › Invariants).
 */
export type PolicySubject<P, K extends PolicyAbility<P>> =
  PolicyParams<P, K> extends [subject: infer S, ...params: any[]] ? S : never;

/**
 * The unique symbol that brands a model type with its policy. A symbol key never shows up as a string key of the
 * model, so typed columns (DB1 #145) and resources do not see it; `HasPolicy` is the only public name.
 */
declare const policyBrand: unique symbol;

/** The type of the policy brand, for a `HasPolicy` that must be named in a signature. */
export type PolicyBrand = typeof policyBrand;

/**
 * The type half of `Gate.policy(Model, Policy)` (docs/v1/auth.md › Policies and gates): a model declares its policy
 * beside its class, and `Gate.allows()` / `Authenticated.can()` type the ability and its arguments from it.
 *
 * @example
 * // app/src/models/Post.ts: a default-exported class, and the same name as an interface (as examples/basic's models)
 * export default class Post extends Model { ... }
 * export default interface Post extends HasPolicy<PostPolicy> {}
 */
export interface HasPolicy<P extends object> {
  // A symbol-keyed method, so the brand is not a string key of the model and a class/interface merge stays lint-clean;
  // never called, and never set at runtime
  [policyBrand]?(): P;
}

/**
 * The policy type a model declares with `HasPolicy`, or `never` when it declares none. A model class is read as its
 * instance, so `Gate.allows(user, "create", Post)` (no model to pass yet) types from the same declaration.
 */
export type ModelPolicy<M> = (M extends abstract new (...args: any[]) => infer I ? I : M) extends infer O
  ? typeof policyBrand extends keyof O
    ? NonNullable<O[typeof policyBrand & keyof O]> extends () => infer P
      ? P
      : never
    : never
  : never;

/**
 * The abilities a subject allows: its policy's `PolicyAbility`, or any `string` before the model declares a policy
 * (`Gate.allows()` then has no ability to check against, and the subject itself fails `CheckPolicy`).
 */
export type SubjectAbility<M> = [ModelPolicy<M>] extends [never] ? string : PolicyAbility<ModelPolicy<M>>;

/**
 * The arguments an ability of subject `M` takes after the subject: `PolicyArgs`, or `unknown[]` before a policy
 * exists.
 */
export type SubjectArgs<M, K extends SubjectAbility<M>> = [ModelPolicy<M>] extends [never]
  ? unknown[]
  : PolicyArgs<ModelPolicy<M>, K & PolicyAbility<ModelPolicy<M>>>;

/**
 * The subject `Gate.allows()` requires for an ability: the policy's subject parameter when it declares one
 * (`update(user, post)` needs a `Post`), and no constraint for an ability with no model of its own (`viewAny(user)` and
 * `create(user)` still take the model class as their subject). `unknown` before a policy is declared: `CheckPolicy`
 * reports that instead.
 */
export type SubjectParam<M, K extends SubjectAbility<M>> = [ModelPolicy<M>] extends [never]
  ? unknown
  : [PolicySubject<ModelPolicy<M>, K & PolicyAbility<ModelPolicy<M>>>] extends [never]
    ? unknown
    : PolicySubject<ModelPolicy<M>, K & PolicyAbility<ModelPolicy<M>>>;

/**
 * The compile check of a subject with no declared policy (`.claude/rules/types.md` › Compile-time checks): the type
 * error shows `error` instead of "not assignable to parameter of type '{ [policyBrand]?: () => object }'".
 */
export type CheckPolicy<M> = [ModelPolicy<M>] extends [never]
  ? { error: "the subject has no policy: add `export default interface <Model> extends HasPolicy<<Policy>> {}` beside its class and register the policy with Gate.policy(<Model>, <Policy>)" }
  : unknown;

export default abstract class Policy {
  abstract viewAny(...args: any[]): PromiseAble<boolean | null>;

  abstract view(...args: any[]): PromiseAble<boolean | null>;

  abstract create(...args: any[]): PromiseAble<boolean | null>;

  abstract update(...args: any[]): PromiseAble<boolean | null>;

  abstract delete(...args: any[]): PromiseAble<boolean | null>;

  abstract restore(...args: any[]): PromiseAble<boolean | null>;

  abstract forceDelete(...args: any[]): PromiseAble<boolean | null>;

  public before(actor: any, ability: string): PromiseAble<boolean | null> {
    return null;
  }
  
}
