---
area: auth
packages: ["@laratype/auth"]
issues: [119, 120, 121, 122, 151, 179, 180, 228, 335]
verified-against: Laratype@d70daa7
last-verified: 2026-10-09
---

# Auth (`@laratype/auth`), skeleton

> **Skeleton.** Every section but [Guards in the container](#guards-in-the-container) (merged), [Typed Register](#typed-register) (proposed) and [Policies and gates](#policies-and-gates) (proposed) is planned. `@laratype/auth` on master is the 0.5 package: guards in `packages/auth/src/guard` and `passport`, policies in `packages/auth/src/policies`, and gates in `packages/auth/src/gate`. This file lists the planned work and a short, non-binding design so that agents don't build against plan sketches. Signatures are added when the issues land.

| Section | Status |
|---|---|
| [Typed Register](#typed-register) | proposed: PR [#363](https://github.com/Laratypes/Laratype/pull/363) @ 2ecef6d → #119 |
| [Authentication from the contract](#authentication-from-the-contract) | planned → #120, #228 |
| [Policies and gates](#policies-and-gates) | proposed: PR [#394](https://github.com/Laratypes/Laratype/pull/394) @ 987371c2 → #121 |
| [Guards in the container](#guards-in-the-container) | merged @ ea7ab23; `attempt()` password check proposed: PR [#346](https://github.com/Laratypes/Laratype/pull/346) @ 74b7e8245a6f86832f6d048bb6a62ed79a33011e; async password check proposed: PR [#393](https://github.com/Laratypes/Laratype/pull/393) @ 9fcf180c90f14c82afba0b2a143efe0a622ecf1b; composite-key rehash and login timing proposed: PR [#396](https://github.com/Laratypes/Laratype/pull/396) @ 488eeb65fe1e856ca03e748aa044e5ff6c4cbc2c; guard claim, model claim, HS256 and guard identity proposed: PR [#358](https://github.com/Laratypes/Laratype/pull/358) @ f37c318ebfb442892b273bd23d40a6fffe55543d; dummy-hash key hardening and the Hasher format/cost rule proposed: PR [#403](https://github.com/Laratypes/Laratype/pull/403) @ 35fdcc6d3f80c086c9905f30d5c1fa3270136abc |
| [OAuth2 server](#oauth2-server) | planned → #179, #180 |

---

## Typed Register

### Status
proposed: PR [#363](https://github.com/Laratypes/Laratype/pull/363) @ 2ecef6d ([#119](https://github.com/Laratypes/Laratype/issues/119), A1, M2).

### Public API
[`packages/auth/src/Register.ts` @ 2ecef6d](https://github.com/Laratypes/Laratype/blob/2ecef6d/packages/auth/src/Register.ts):

```ts
// @laratype/auth
export interface Register {}

export type RegisteredUser<R = Register> = R extends { user: infer U extends Model } ? U : Model;
export type GuardName<R = Register> = R extends { guards: infer G } ? keyof G & string : string;
```

An app fills `Register` once, by module augmentation. `Auth` and `AuthService` come from [`packages/auth/src/support/Auth.ts` @ 2ecef6d](https://github.com/Laratypes/Laratype/blob/2ecef6d/packages/auth/src/support/Auth.ts), `AuthManager` from [`packages/auth/src/guard/AuthManager.ts` @ 2ecef6d](https://github.com/Laratypes/Laratype/blob/2ecef6d/packages/auth/src/guard/AuthManager.ts), and `AuthVerification` from [`packages/auth/src/verifications/AuthVerification.ts` @ 2ecef6d](https://github.com/Laratypes/Laratype/blob/2ecef6d/packages/auth/src/verifications/AuthVerification.ts):

```ts
// @laratype/auth
export class AuthService {
  attempt<T extends Model>(user: T): Promise<false | Authenticated<T>>;
  user<T extends Model = RegisteredUser>(): Authenticated<T> | null;
  login<T extends Model>(user: T): Authenticated<T>;
  guard<T extends Model = RegisteredUser>(guardName: GuardName): Authenticate<T>;
}

export class Auth extends Facade {
  /* the same methods, static; attempt() stays an instance method as in 0.5 */
}

export class AuthManager {
  guard<User = any>(name?: GuardName): TokenGuard<User>;
}

export class AuthVerification {
  static guard(guardName: GuardName): TokenGuard<any>;
}
```

`Authenticate<T>` is the per-guard handle of a call (`user(): Authenticated<T> | undefined`, `attempt(fields): Promise<false | Authenticated<T>>`); `Authenticated<T>` is the unchanged wrapper (`getUser(): T`, `generateToken(options)`).

### Invariants
- **Type-only.** The registry has no runtime value: A1 changes no guard lookup, no config shape and no runtime behaviour. `Auth.user()` still returns the `Authenticated` wrapper (D8 #115), not the model, and `.getUser()` gives the user.
- **The registered user is the default type argument.** `Auth.user()` with no type argument is `Authenticated<Register['user']> | null` (for example `Authenticated<User> | null`) once the app registers `user`; `Auth.guard(name).user()` is `Authenticated<User> | undefined`, and `Auth.guard(name).attempt(fields)` is `Promise<false | Authenticated<User>>`. An explicit type argument still wins: `Auth.user<Admin>()` is `Authenticated<Admin> | null`.
- **Guard names.** Once `guards` is registered, `Auth.guard(name)`, `AuthService.guard(name)`, `AuthVerification.guard(name)` and `AuthManager.guard(name)` accept only `keyof Register['guards']`. The default guard (no name) is not affected. `Passport.authenticate(name)` keeps passport's `string | string[] | Strategy`: it runs any passport strategy, not only an auth guard.
- **Before a registration.** `RegisteredUser` is `Model` and `GuardName` is `string`, so 0.5 code keeps its types: `Auth.user()` is `Authenticated<Model> | null`, `Auth.user<User>()` compiles, and every string is a guard name.
- **Registry values are not read.** Only the keys of `Register['guards']` type the names; per-guard user types are not part of A1.
- **Boundary with the contract.** `@laratype/contract` stays browser-pure and never imports `@laratype/auth`. It types `auth: '<guard>'` from its own `GuardRegistry` (C4b #228); until A2 #120 links the two, an app that uses both augments both registries (auth may import contract, never the reverse).

### Diagnostics
- **Wrong guard name (type-level).** `Auth.guard('nope')` (and the other guard-name APIs) fails with `Argument of type '"nope"' is not assignable to parameter of type '"api" | "web" | "admin"'`, naming the registered guards. `Auth.guard('web')` compiles.
- **Runtime.** The registry never replaces the runtime check: an unknown name that got past the types throws `[@laratype/auth] Auth guard "<name>" is not defined in app/config/auth.ts.` (`AuthManager`).
- **Missing registration.** No type error: `Auth.user()` is `Authenticated<Model> | null` (today's 0.5 type) and `Auth.guard('anything')` compiles, as in 0.5.

### Example
[`examples/auth/proposed/typed-register.ts`](./examples/auth/proposed/typed-register.ts); the type tests are `packages/auth/__tests__/typedRegister.test-d.ts` (registered) and `packages/auth/__tests__/typedRegister.test.ts` (the unregistered fixture).

### Non-goals
- No runtime registry check and no per-guard user type.
- No change to the contract's `GuardRegistry` or to `auth: '<guard>'`: A2 #120 links the two registries.
- `Auth.user()` does not return the bare model: the `Authenticated` wrapper stays.

### Open questions
- [A2 #120](https://github.com/Laratypes/Laratype/issues/120): link `Register['guards']` to the contract's `GuardRegistry` (auth may import contract, never the reverse).

### Acceptance
[#119 Done when](https://github.com/Laratypes/Laratype/issues/119)

---

## Authentication from the contract

### Status
planned → [#120](https://github.com/Laratypes/Laratype/issues/120) (A2, M2), with the contract types in [#228](https://github.com/Laratypes/Laratype/issues/228) (C4b).

### Design (non-binding)
- **Declared in the contract:** `auth: true | '<guard>'` on a scope, a contract or an endpoint. `true` uses the default guard. The nearest level wins, and `.public()` opts an endpoint out ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)).
- **Applied by the framework:** the guard runs from the contract. API routes don't use `.middleware(auth())`.
- **Guard names** are typed from the app's guard registry ([Typed Register](#typed-register), [#119](https://github.com/Laratypes/Laratype/issues/119)). Until A2 [#120](https://github.com/Laratypes/Laratype/issues/120) links it, the contract's `GuardRegistry` is separate from `@laratype/auth`'s `Register['guards']` (see [Typed Register](#typed-register)).
- **Context:** `ctx.user` is typed per guard ([http.md › Controller typing](./http.md#controller-typing-ctx-and-controllerof)).
- **Unauthenticated:** a 401 (`errors.unauthorized`).
- **Other 403s from auth:** an unverified or locked account is a domain error, for example `defineError(403, 'EMAIL_NOT_VERIFIED')`. The guard throws it, and the contract or scope declares it with `throws` ([contract.md › Domain errors](./contract.md#domain-errors)).

### Acceptance
[#120 Done when](https://github.com/Laratypes/Laratype/issues/120)

---

## Policies and gates

### Status
proposed: PR [#394](https://github.com/Laratypes/Laratype/pull/394) @ 987371c2 ([#121](https://github.com/Laratypes/Laratype/issues/121), A3, M2). Route integration: [#105](https://github.com/Laratypes/Laratype/issues/105) ([http.md › Authorization from the contract](./http.md#authorization-from-the-contract)), which supersedes [#122](https://github.com/Laratypes/Laratype/issues/122) (H8); the call this section leaves to #105 is listed under [Invariants](#invariants-1).

### Public API
[`Policy.ts`](https://github.com/Laratypes/Laratype/blob/987371c2/packages/auth/src/policies/Policy.ts) (types), [`authorize.ts`](https://github.com/Laratypes/Laratype/blob/987371c2/packages/auth/src/policies/authorize.ts), [`Gate.ts`](https://github.com/Laratypes/Laratype/blob/987371c2/packages/auth/src/gate/Gate.ts), [`GateAbility.ts`](https://github.com/Laratypes/Laratype/blob/987371c2/packages/auth/src/gate/GateAbility.ts), [`GateManager.ts`](https://github.com/Laratypes/Laratype/blob/987371c2/packages/auth/src/gate/GateManager.ts), [`ForbiddenException.ts`](https://github.com/Laratypes/Laratype/blob/987371c2/packages/auth/src/exceptions/ForbiddenException.ts) and `Authenticated` in [`AuthVerification.ts`](https://github.com/Laratypes/Laratype/blob/987371c2/packages/auth/src/verifications/AuthVerification.ts), all exported from `@laratype/auth`.

```ts
// @laratype/auth
export type PolicyClass = abstract new (...args: any[]) => object;

/** A policy with any ability name: the default of the generic types below, so their bare names mean "any" */
export type AnyPolicy = { [ability: string]: (user: any, subject: unknown) => any };

/** The string method names of P minus "before" */
export type PolicyAbility<P = AnyPolicy> = Exclude<Extract<{
  [K in keyof P]-?: P[K] extends (...args: any[]) => any ? K : never
}[keyof P], string>, "before">;

/** The parameters of an ability after the user and the subject: update(user, post) gives [], share(user, post, target) gives [target] */
export type PolicyArgs<P = AnyPolicy, K extends PolicyAbility<P> = PolicyAbility<P>> = /* PolicyParams<P, K> extends [subject: any, ...args: infer A] ? A : [] */;
/** The subject parameter of an ability: update(user, post) gives Post, viewAny(user) gives never */
export type PolicySubject<P = AnyPolicy, K extends PolicyAbility<P> = PolicyAbility<P>> = /* PolicyParams<P, K> extends [subject: infer S, ...params: any[]] ? S : never */;

/** The type half of Gate.policy(Model, Policy); the brand is an optional unique-symbol method, never a string key */
export interface HasPolicy<P extends object = AnyPolicy> { [policyBrand]?(): P }
export type PolicyBrand = /* typeof policyBrand */;
export type ModelPolicy<M = HasPolicy<AnyPolicy>> = /* the policy M declares, a model class read as its instance; never without one */;
export type SubjectAbility<M = HasPolicy<AnyPolicy>> = /* PolicyAbility<ModelPolicy<M>>, or string without a declared policy */;
export type SubjectArgs<M = HasPolicy<AnyPolicy>, K extends SubjectAbility<M> = SubjectAbility<M>> = /* PolicyArgs<ModelPolicy<M>, K>, or unknown[] without one */;
export type SubjectParam<M = HasPolicy<AnyPolicy>, K extends SubjectAbility<M> = SubjectAbility<M>> = /* PolicySubject<ModelPolicy<M>, K>, or unknown for an ability with no subject */;
export type CheckPolicy<M = HasPolicy<AnyPolicy>> = /* { error: "the subject has no policy: ..." } without a declared policy */;

export interface GateAbility<Args extends readonly unknown[] = readonly unknown[]> {
  readonly name: string;
  readonly check: (user: unknown, ...args: Args) => Promise<boolean>;
}

export abstract class Gate {
  abstract handle(...args: any): boolean;                       // the 0.5 gate base, unchanged
  static policy<M extends object>(
    model: AbstractNewable<M>,
    policy: [ModelPolicy<M>] extends [never] ? PolicyClass : AbstractNewable<ModelPolicy<M>>,
  ): void;
  static allows<M, K extends SubjectAbility<M>, A extends SubjectArgs<M, K> & unknown[]>(
    user: unknown, ability: K, subject: M & CheckPolicy<M> & SubjectParam<M, K>, ...args: A): Promise<boolean>;
  static allows<Args extends readonly unknown[]>(user: unknown, ability: GateAbility<Args>, ...args: Args): Promise<boolean>;
  static denies</* the same two overloads */>(...): Promise<boolean>;
  static authorize</* the same two overloads */>(...): Promise<void>;   // throws ForbiddenException
  static define<Args extends readonly unknown[]>(
    name: string,
    fn: (user: any, ...args: Args) => PromiseAble<boolean | null>,
  ): GateAbility<Args>;
}

export class GateManager {                                       // a singleton in the container (D7)
  policy<M extends object>(model: AbstractNewable<M>, policy: PolicyClass): this;
  policyFor(subject: unknown): PolicyClass | undefined;
  allows(user: unknown, ability: string, subject: unknown, ...args: unknown[]): Promise<boolean>;
  denies(user: unknown, ability: string, subject: unknown, ...args: unknown[]): Promise<boolean>;
  authorize(user: unknown, ability: string, subject: unknown, ...args: unknown[]): Promise<void>;
  static current(): GateManager;
  static container(): Container;
}

export class Authenticated<T extends Model> {
  can<M, K extends SubjectAbility<M>, A extends SubjectArgs<M, K> & unknown[]>(
    ability: K, subject: M & CheckPolicy<M> & SubjectParam<M, K>, ...args: A): Promise<boolean>;
  cannot</* can() */>(...): Promise<boolean>;
}

export function policyCheck(policy: object, user: unknown, ability: string, ...args: unknown[]): Promise<boolean | null>;
export function policyAllows(policy: object, user: unknown, ability: string, ...args: unknown[]): Promise<boolean>;
export function policyAuthorize(policy: object, user: unknown, ability: string, ...args: unknown[]): Promise<void>;
export class ForbiddenException extends Exception {}              // 403, { code: "FORBIDDEN", message }
```

The public generic types default to `AnyPolicy` and `HasPolicy<AnyPolicy>`, so their bare names compile and mean any policy (`.claude/rules/types.md` › Generics): `PolicyAbility` is `string`, `PolicySubject`, `SubjectParam` and `CheckPolicy` are `unknown`, `PolicyArgs` and `SubjectArgs` are `[]`, `HasPolicy` is `HasPolicy<AnyPolicy>` and `ModelPolicy` is `AnyPolicy`. A real policy keeps its own names and parameters.

A policy is any class with ability methods and an optional `before`; the 0.5 `Policy` base class is not required:

```ts
class PostPolicy {
  before(user: User, ability: string, ...args: unknown[]): boolean | null { return null }
  viewAny(user: User): boolean { return true }
  update(user: User, post: Post): Promise<boolean> { return Promise.resolve(user.id === post.userId) }
}
```

### Invariants
- **Abilities are methods.** An ability is a string method name of the policy, minus `before`; a field that is not a method is not an ability, as in the router's policy proof ([http.md › Route proof at r.contract()](./http.md#route-proof-at-rcontract)). The policy is looked up from the subject's class, and the subject is the ability's first parameter after the user: `Gate.allows(user, "update", post)` runs `update(user, post)`, and any extra arguments follow it. An ability that declares a subject parameter types its subject (`SubjectParam`): `update(user, post: Post)` takes a `Post` instance, not the `Post` class, and the same constraint applies to `Authenticated.can()` and `cannot()`. An ability with no model of its own (`viewAny(user)`) is checked with the model class as the subject, which it ignores — `create(user)` works the same.
- **The policy declares its abilities, not `Object.prototype`.** Only a function the policy instance or a class below `Object.prototype` declares is an ability; `Object.prototype`'s own names (`hasOwnProperty`, `propertyIsEnumerable`, `toString`, `valueOf`, `isPrototypeOf`, `toLocaleString`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, `__proto__`), `constructor` and `before` never run. Otherwise `hasOwnProperty(user)` would ask whether the policy has a field named `String(user)` and answer `true` for an injected `repo` ([#394](https://github.com/Laratypes/Laratype/issues/394)). An accessor is never an ability: the lookup reads the property descriptor, so a getter does not run and its value is not used — a getter returning `() => true` is no ability, so when `before` does not decide, `Gate.allows()` and `Gate.authorize()` deny it (`policyCheck()` answers `null`, as when the method is missing), and a getter that throws does not reach a 500. Every method of a policy class is an ability at runtime, `protected` and `private` included (neither exists at runtime), so keep a helper `#private` (a real private field) or outside the class.
- **Only `true` allows.** An ability allows when it resolves exactly `true`; `null`, `undefined`, a truthy string or object deny. `before(user, ability, ...args)` short-circuits only on a boolean: `true` allows, `false` denies, anything else falls through to the ability. 0.5 policies declare `before(actor, ability)`, which keeps working: the extra arguments are ignored.
- **Async is awaited.** `before` and the ability may return a value or a promise; `Gate.allows()`, `Gate.denies()` and `Gate.authorize()` always return a promise.
- **Registration.** `Gate.policy(Model, Policy)` in a service provider's `register()` or `boot()` links a model class to its policy. A model has one policy: registering the same class again is a no-op, another class throws. The model class is also a valid subject, for an ability with no model yet, such as `Gate.allows(user, "create", Post)`. Registration is a boot-time act: `Gate.policy()` is refused inside a request — any request store, container or not — with `InternalException`, because the registry is the app's singleton and a policy added there would outlive the request and reach every later one ([#394](https://github.com/Laratypes/Laratype/issues/394)); register policies in a service provider, and do not work around it. `Gate.define()` registers nothing — it returns a value — so it is usable anywhere, a request included.
- **Exact class only.** The policy is looked up by the subject's own class (`Object.getPrototypeOf(subject).constructor` for an instance, never an own `constructor` field the subject object could spoof; the class itself for a class), with no parent walk: a subclass needs its own `Gate.policy()`. The same resolved class names the missing-policy diagnostic.
- **Where the registry and the policy live.** `GateManager.current()` is a singleton in the current request's container, else the facade application, and is bound on its first use, as `RouteRegistry` and `ModelBindingRegistry` are ([di.md › Container-backed registries and facades](./di.md#container-backed-registries-and-facades)). A new container starts with none. The policy instance is built by `GateManager.container().make(policy)`, so constructor injection works and reaches request-scoped dependencies ([http.md › Controller resolution](./http.md#controller-resolution), H21 #269).
- **Guests deny, without the policy.** A guest is any non-object user: `null`, `undefined`, `false` (what `TokenGuard.user()` answers for a request with no bearer token) and every primitive or function (`0`, `""`, a number, `NaN`, a symbol, a function) answer `false` from `allows()`, `true` from `denies()` and the 403 from `authorize()`, and neither a policy nor a gate runs. A gate or policy may still declare a nullable user (`user: User | null`); the guest check runs first, so it never sees the `null`. On a route the auth guard answers the 401 first ([Authentication from the contract](#authentication-from-the-contract)).
- **A missing policy is an internal error.** `allows()`, `denies()` and `authorize()` reject with `InternalException` (500) when the subject's class has no policy: a bug must not read as a denial, and a caller's `.catch()` / `.then()` sees it. `GateManager.allows()` is `async` for that reason (and `Authenticated.can()` returns its promise), so the error never escapes synchronously. A policy without the ability method (and without a `before` that decided) denies.
- **Exceptions are not denials.** What a `before` or an ability throws propagates (the exception filter's 500); it is never caught into `false`.
- **The 403 is the contract's derived forbidden.** `authorize()` throws `ForbiddenException`, a responsible `Exception` with `code: "FORBIDDEN"`, `httpCode: 403` and the message `This action is unauthorized.`, so its wire body `{ code: "FORBIDDEN", message }` is the one `errors.forbidden()` declares ([contract.md › Built-in errors](./contract.md#built-in-errors)); the filter answers a responsible 4xx `Exception` with its `toJson()` ([http.md › Exceptions](./http.md#exceptions)). `@laratype/auth` imports no contract runtime: the 403 is the 0.5 exception channel.
- **Two `can()` meanings stay side by side.** `Authenticated.can(ability, subject, ...args)` (`Auth.user()!.can("update", post)`) resolves the **subject's** policy, as Laravel's `$user->can()` does. The 0.5 `@UsePolicy(Policy)` mixin on a model keeps its own meaning: `model.can(ability, ...args)` runs the **actor's** policy with the model as the user. A v1 model declares its policy with `export default interface Post extends HasPolicy<PostPolicy> {}` beside its `export default class Post`, which is the type half of `Gate.policy`; nothing is added to the model at runtime, and the default-export pair is the shape the repo's models already use (a named class/interface merge is a lint error).
- **A gate is a typed value.** `Gate.define(name, fn)` returns `{ name, check }`; `Gate.allows(user, gate, ...args)` checks it, with no registry and no second type map. A gate's arguments come from `fn`; `Gate.allows()`, `Gate.denies()` and `Gate.authorize()` apply the same exact-`true` rule as the policy checks to the gate's answer, whichever object is passed (a hand-built `GateAbility` included), so a truthy non-boolean (`1`, `"yes"`, an object, a promise or thenable of one) denies; what the check throws or rejects propagates. A guest denies without the gate running.
- **Route integration (proposed for #105).** `policyCheck(policy, user, ability, ...args)` is the tri-state single check (`true`, `false`, or `null` when `before` fell through and the ability name matches no method), `policyAllows()` is `=== true` and `policyAuthorize()` throws the 403 unless it allows. An ability method that returns `null` is a denial (`false`), not a `null` check: only an explicit `true` allows. A proposal for #105, not its decision: for each mounted scope policy, outer to inner, `policyCheck(instance, user, <endpoint key>, params)` — `false` answers the 403, `true` allows the request and skips the remaining policies, `null` continues — then the endpoint's policy with `policyAuthorize(instance, user, <endpoint key>, params)`, where `params` is the bound-model record the route resolved. That is what answers [http.md › Authorization from the contract](./http.md#authorization-from-the-contract)'s open question on the endpoint policy's arguments. Because `null` means the ability name matches no method, a typo in an endpoint key must be a deny in #105, never a fall-through that allows.

### Diagnostics
`Error` messages (exact text), all `InternalException` (500) unless stated:
- `[@laratype/auth] Gate.policy: register policies in a service provider, not inside a request.`
- `[@laratype/auth] Gate.policy: the model must be a class, got <typeof>.`
- `[@laratype/auth] Gate.policy: the policy must be a class, got <typeof>.`
- `[@laratype/auth] <Model> already has the policy <Policy>; a model has one policy (register it once).`
- `[@laratype/auth] Gate.allows: no policy is defined for <Model>. Fix: register it with Gate.policy(<Model>, <Policy>) in a service provider.` — `Gate.authorize` with its own name in place of `Gate.allows`.
- `[@laratype/auth] Gate.allows: the ability must be an ability name or a gate from Gate.define(), got <typeof>.` — `Gate.denies` and `Gate.authorize` likewise.
- `[@laratype/auth] Gate.define: the name must be a non-empty string, got <typeof>.`
- `[@laratype/auth] Gate.define: the gate must be a function, got <typeof>.`

The 403's body: `{ "code": "FORBIDDEN", "message": "This action is unauthorized." }`.

Type-level, from `Gate.allows()` and `Authenticated.can()`:
- Unknown ability: `Argument of type '"nope"' is not assignable to parameter of type '"viewAny" | "update" | "delete"'`.
- Wrong argument, `Gate.allows(user, "share", post, 1)` against `share(user: User, post: Post, target: User)`: `Argument of type '[number]' is not assignable to parameter of type '[target User] & unknown[]'` (the rest parameter is the ability's own arguments).
- A subject that is not the ability's subject, `Gate.allows(user, "update", Post)` against `update(user: User, post: Post)`: `Argument of type 'typeof Post' is not assignable to parameter of type 'typeof Post & Post'`.
- A subject with no declared policy: the `CheckPolicy` intersection fails, ``Property 'error' is missing in type 'Comment' but required in type '{ error: "the subject has no policy: add `export default interface <Model> extends HasPolicy<<Policy>> {}` beside its class and register the policy with Gate.policy(<Model>, <Policy>)"; }'``.
- `Gate.policy(Post, OtherPolicy)` on a declared `HasPolicy<PostPolicy>`: `Argument of type 'typeof OtherPolicy' is not assignable to parameter of type 'AbstractNewable<PostPolicy>'`.
- A gate's wrong argument or arity: `Argument of type 'Post' is not assignable to parameter of type 'User'`, and `Expected 1 arguments, but got 0` for a gate whose `fn` takes one.

### Example
[`examples/auth/proposed/policies.ts`](./examples/auth/proposed/policies.ts); the type tests are `packages/auth/__tests__/policies.test-d.ts` and the runtime ones `packages/auth/__tests__/policies.test.ts`.

### Non-goals
- No route integration here: `{ policy }` on `r.scope()` / `r.contract()` and the `authorize` capability stay [#105](https://github.com/Laratypes/Laratype/issues/105)'s, and this section does not run them.
- No policy auto-discovery from a model's name (Laravel's `guessPolicyName`): `Gate.policy()` is explicit.
- No named gate registry: `Gate.define()` returns the value to check, so `Gate.allows(user, "update-post", post)` is not an API ([#121](https://github.com/Laratypes/Laratype/issues/121) chose typed values).
- No global gate hooks (`before`/`after` on `Gate` itself) and no `Gate::any`/`none`.
- No per-guard user type in a policy: the ability declares its own `user` parameter.

### Open questions
- [#105](https://github.com/Laratypes/Laratype/issues/105)

### Acceptance
[#121 Done when](https://github.com/Laratypes/Laratype/issues/121)

---

## Guards in the container

### Status
merged @ ea7ab23 ([#151](https://github.com/Laratypes/Laratype/issues/151), A4, M3), on top of #330's guards. The `attempt()` password check is proposed: PR [#346](https://github.com/Laratypes/Laratype/pull/346) @ 74b7e8245a6f86832f6d048bb6a62ed79a33011e; the async password check (`Hash.checkAsync()` / `Hash.makeAsync()`) is proposed: PR [#393](https://github.com/Laratypes/Laratype/pull/393) @ 9fcf180c90f14c82afba0b2a143efe0a622ecf1b; the composite-key rehash and login timing fixes are proposed: PR [#396](https://github.com/Laratypes/Laratype/pull/396) @ 488eeb65fe1e856ca03e748aa044e5ff6c4cbc2c; the guard claim, model claim, HS256 and guard identity are proposed: PR [#358](https://github.com/Laratypes/Laratype/pull/358) @ f37c318ebfb442892b273bd23d40a6fffe55543d; the dummy-hash key hardening (a throwing `constructor` read falls back to the instance key) and the one-class-per-format/cost rule are proposed: PR [#403](https://github.com/Laratypes/Laratype/pull/403) @ 35fdcc6d3f80c086c9905f30d5c1fa3270136abc. The auth config is bound in `register()` from the app manifest, not through `config('auth')`, because K1 [#152](https://github.com/Laratypes/Laratype/issues/152) fills the config store after every `register()` (see [Invariants](#invariants)). The shared driver `Manager` stays F1 [#160](https://github.com/Laratypes/Laratype/issues/160), and the session guard needs a session package; see the [Open questions](#open-questions).

### Public API
[`packages/auth/src/guard/` @ 488eeb65fe1e856ca03e748aa044e5ff6c4cbc2c](https://github.com/Laratypes/Laratype/tree/488eeb65fe1e856ca03e748aa044e5ff6c4cbc2c/packages/auth/src/guard) (`AuthManager.ts`, `TokenGuard.ts`, `PassportGuard.ts`, `tokens.ts`), exported from `@laratype/auth`; the D8 facade `Auth` and its `AuthService` come from [`packages/auth/src/support/Auth.ts` @ ea7ab23](https://github.com/Laratypes/Laratype/blob/ea7ab23091a211129d1c95822eac5275eb66f74b/packages/auth/src/support/Auth.ts).

```ts
// @laratype/auth
export const AUTH_CONFIG: InjectionToken<LaratypeConfig.Auth>;
export type GuardConfig = LaratypeConfig.Auth['guards'][string];
export type JWTSignOptions = { expiresIn?: number; name: string; abilities: string };

export class AuthManager {                                  // singleton in the app container
  constructor(config: LaratypeConfig.Auth, tokenModel?: typeof Model);
  readonly config: LaratypeConfig.Auth;
  get defaultGuard(): string;                               // config.default.guard
  guard<User = any>(name?: string): TokenGuard<User>;       // cached per name; default guard when omitted; GuardName after A1 #119
}

export class TokenGuard<User = any> {
  constructor(name: string, config: GuardConfig, tokenModel?: typeof Model);
  readonly name: string;
  readonly config: GuardConfig;
  token(request: Request): string | undefined;              // request.bearerToken() || undefined
  user(request: Request): Promise<User | false>;
  verify(token: string): Promise<User | false>;
  attempt(fields: Record<string, any>): Promise<User | null>;  // Hash.checkAsync() after the lookup; the password is never a WHERE value
  issueToken(user: User, options: JWTSignOptions): Promise<string>;
}

export class PassportGuard<User = any> extends TokenGuard<User> {
  register(passport: PassportStatic, store: unknown): void; // passport.use(name, new config.strategy(...))
}

// @laratype/support: LaratypeConfig.Auth guard entries
type AuthGuard = {
  readonly strategy?: typeof Strategy;                       // optional since A4: none = TokenGuard
  readonly strategyName?: string;
  readonly options?: Record<string, any>;
  provider: any;
  verification: 'jwt' | 'oauth2';
};
```

The 0.5 API keeps its signatures and resolves its guards from the request's container: `Auth.guard(name)`, `Auth.user()`, `Auth.login()`, `AuthVerification.guard(name)` (now returns the `TokenGuard`), `AuthVerification.verify(token)`, `AuthGuard` and `Passport.authenticate(name)`. `Auth` is D8's facade ([di.md › Container-backed registries and facades](./di.md#container-backed-registries-and-facades)) over the stateless `AuthService`, which builds a per-guard handle for each of those calls. A1 [#119](https://github.com/Laratypes/Laratype/issues/119) narrows the `name` of `Auth.guard`, `AuthVerification.guard` and `AuthManager.guard` to `GuardName` ([Typed Register](#typed-register)); the runtime resolves the same config keys.

### Invariants
- **Binding:** `PassportServiceProvider.register()` loads `app/config/auth.ts` and the `PersonalAccessToken` model from the app manifest, binds the config to `AUTH_CONFIG` with `instance()`, and binds `AuthManager` as a singleton. Both are available in every provider's `boot()`. `register()` runs before any `boot()`, so K1's [`config('auth')`](./config.md) store is not filled yet: the config comes from the manifest, and K1's `ConfigLoadServiceProvider` then loads the same module (the runtime's module cache), so both hold one object. The auth config may read `Env.get()`, and `EnvLoadServiceProvider` loads the env file only in its `boot()`, after every `register()`: `PassportServiceProvider.register()` loads it first, so `auth.ts` never reads an env file it has not loaded. An `app/config/env.ts` schema is validated in `EnvLoadServiceProvider.boot()`, after `auth.ts` was evaluated, so a value that fails the schema has already been read; the boot still fails there, before any provider's `boot()` runs the app ([config.md › Environment validation](./config.md#environment-validation)).
- **Drivers:** `guard(name)` builds a `PassportGuard` when the guard's config has a `strategy`, else a `TokenGuard`. A guard is built once per name and cached by the manager. There is no `extend()`: custom drivers come with the shared `Manager` (F1 [#160](https://github.com/Laratypes/Laratype/issues/160)).
- **Passport:** `PassportServiceProvider.boot()` registers the strategy of every `PassportGuard` under the guard's name, so `Passport.authenticate('<guard>')` runs it. The local strategy's verify callback calls the guard's `attempt()` with `options.usernameField` and `options.passwordField`; another strategy fails with `Strategy not implemented`, as in 0.5. `attempt()` takes the password out of the fields by `options.passwordField` (the provider model's `static passwordField` when the option is not set, `password` by default), looks the user up by the remaining fields only, with the password column added to the select, and then checks the password with `Hash.checkAsync()`: a salted hash can't be matched in the query, so the plain password is never a WHERE value (only the stored hash, in the conditional rehash update), and scrypt runs on the libuv pool instead of the event loop. Only an explicit `true` from `Hash.checkAsync()` logs in, so a custom Hasher that resolves a truthy non-boolean is denied. The lookup values may be strings, booleans or finite numbers, and the password must be a string; at least one lookup field must remain after the password is taken out, and another value (an object, an array, `null`, `NaN`, an infinity) fails as an invalid credential before any query. The model hashes its own credential column ([database.md › Model](./database.md#model)), so a guard whose `options.passwordField` names a different field throws before any query. An unknown user still runs one asynchronous dummy check, against a hash the resolved `Hasher`'s class builds once (the cache is per class, so concurrent requests and a transient `bind(Hasher, CustomHasher)` share the pending build; another class builds its own, so the dummy check runs the algorithm and cost of the class it uses, and a rejected build is retried), at the same derivation cost as a current-format user's check, so it does not reveal whether the user exists. The key is the class alone: two instances of one class that use different formats or costs share the first instance's dummy, so a check that rejects a foreign format before deriving skips the padding. Expose one class per format and cost; a change that keeps the class keeps the old dummy until the process restarts. A Hasher with no class of its own (an object literal, a null-prototype object, or one whose `constructor` read throws) is keyed by its instance, so two object-literal Hashers never share a dummy; a transient factory that returns a new object-literal Hasher on each resolve therefore builds a new dummy on every request, where a class binding shares one. The same holds for a Hasher class whose `constructor` read throws when it is bound transient: each request builds a new dummy, so an unknown user costs two derivations (the dummy `make` and its `check`) against one for a known user, a timing difference that can reveal accounts. Bind such a Hasher, or a literal factory, as a singleton. That padding is best effort: the inputs the guard refuses before hashing (a password that is not a string, no lookup field left after the password is taken out, a lookup value that is not a string, a boolean or a finite number) answer `null` without a dummy check, and an unknown user whose dummy build rejects answers `null` with no completed check. A user whose stored hash is a 0.5 sha256 or unparseable also pays that dummy check, since its real check runs no scrypt, so the timing does not show that the account still holds a legacy hash (unless the dummy build rejects). A successful login replaces a hash from an older format (`needsRehash()`, with `Hash.makeAsync()`) only when the update still matches the hash it checked, by every primary column, so a composite-key row is named by its whole key and a row that lacks part of its key or whose key carries a null part is left alone; a password change committed while `makeAsync()` runs keeps its newer hash, and a failed or unmatched replacement still logs the user in and leaves the returned user's hash as it was read. The returned user keeps the password when the column is selectable, as a plain lookup does, and has no password key when it is `{ select: false }`, so a provider that must not hand it back marks the column that way. `options.passwordField` is an entity property name, the one `findColumnWithPropertyName()` takes. `options` is optional since A4 (token guards have none); a local guard needs both `usernameField` and `passwordField`, and they must be different fields, because the verify callback looks the user up by exactly those keys and takes the password out of them, so `PassportServiceProvider.boot()` throws for a local guard that lacks one, sets one to `''`, or gives them the same name (see Diagnostics). The verify callback takes `(username, password, done)`, so a local guard with `options.passReqToCallback` throws at boot too.
- **Login concurrency:** the password check (`Hash.checkAsync()` / `Hash.makeAsync()`) runs on the libuv thread pool, whose default is 4 threads shared with `fs`, `dns.lookup` and `zlib`, so a login flood queues behind it: the security review measured `fs.readFile` going from 8 ms to 485 ms under 40 concurrent logins. Put the login route behind the throttle ([http.md › Rate limiting](./http.md#rate-limiting)), per IP and per account. Set `UV_THREADPOOL_SIZE` before the process starts (libuv reads it when the pool is first used), and each extra concurrent hash costs 16 MiB (N=16384, r=8), so size the pool and the memory together.
- **Token:** a token guard reads it with `request.bearerToken()` only, never from `Authorization` itself (A5 [#288](https://github.com/Laratypes/Laratype/issues/288), shipped in the 0.5 `AuthGuard`). It returns the token of `Authorization: Bearer <token>`, with the scheme in any case and the token an RFC 6750 b64token, else `""`, and the guard answers its 401.
- **Verification:** with a `PersonalAccessToken` model, a token must have a record whose `expires_at` is in the future; the record's `verification_type` picks the verifier, and its `tokenable_type` and `tokenable_id` load the user; a record whose `tokenable_type` is not the guard's `provider` or a subclass of it denies before the lookup. Without the model, `verify()` loads the user from the guard's `provider` model, by the primary key `ModelManagement.getPrimaryKeyFromModel()` names, from the value the token carries under `payload.id`; a token whose user no longer exists denies, and nothing stores the token, so it cannot be revoked before its `exp` ([A6 #335](https://github.com/Laratypes/Laratype/issues/335)). Only `jwt` is implemented: another `verification`, or a record whose `verification_type` is not `jwt`, throws `UnsupportedVerificationModeException` (`code: "UNSUPPORT_VERIFICATION_MODE"`).
- **Guard claim:** `issueToken()` signs the guard's name into the token's `guard` claim, and `verify()` denies a token whose claim is missing or is another guard's name, before it loads a user: a token issued by guard A never authenticates guard B, even when both guards share the app key. Tokens issued before the claim existed stop verifying ([A6 #335](https://github.com/Laratypes/Laratype/issues/335)).
- **Model claim:** `issueToken()` signs the user's own model name (`constructor.name`) into the token's `payload.type` claim and refuses, with an `InternalException` (`Guard "<name>" issues tokens for <Provider>, not <Model>.`), a user the guard cannot load back: without a `PersonalAccessToken` model only an instance of the guard's `provider` itself (`user.constructor === provider`; a subclass with its own table would load a different row by the same id), with one an instance of the provider or a subclass of it, since the record's `tokenable_type` loads the user's own model. `verify()` denies a token whose claim is missing, or names another model than the `provider` (without a token record) or than the record's `tokenable_type` (with one), before it loads a user, so a token signed for another model never authenticates the guard ([A6 #335](https://github.com/Laratypes/Laratype/issues/335), [#358](https://github.com/Laratypes/Laratype/pull/358)).
- **Class names in production builds:** the model claim and `tokenable_type` compare `constructor.name`, so a production build must keep class names (esbuild/Bun `keepNames`, terser `keep_classnames`); a build that renames model classes denies every token.
- **Algorithm:** `issueToken()` signs with HS256, and `verify()` accepts `algorithms: ["HS256"]` only: a token signed with another algorithm, even with the same secret, does not verify ([A6 #335](https://github.com/Laratypes/Laratype/issues/335)).
- **Guard identity:** `AuthGuard` and a successful `Passport.authenticate(name)` record the guard that authenticated the request, and `Auth.user()` and `Auth.login()` bind that guard: `login()` after `Passport.authenticate('admin')` signs for `admin`, not the default guard. `Auth.guard(name)` stays explicit, and the default guard applies only when no guard authenticated the request ([A6 #335](https://github.com/Laratypes/Laratype/issues/335)).
- **Resolution:** `Auth`, `AuthGuard` and `AuthVerification` resolve `AuthManager` from the container of the current request (`ContextApi.getContainer()`); `Auth` does it through D8's facade and `AuthService`. `Passport.authenticate(name)` runs the strategy that `PassportServiceProvider.boot()` registered under that name. There is no guard state shared across requests: `globalThis.__laratype_auth_config` and `__laratype_auth_model_verify` are removed, and the guard that authenticated a request lives in a `WeakMap` keyed by that request's store (`support/guardContext.ts`).
- **Outside a request** resolving a guard throws (see Diagnostics); `Auth.guard(name)` resolves it lazily, on `attempt()` or `login()`, and `Auth.user()` answers `null` because no user is authenticated. Code outside a request resolves `AuthManager` from the container it has, such as a provider's `this.app`.

### Diagnostics
`Error` messages (exact text):
- `app/config/auth.ts not found: the app manifest has no auth config` (`register()` fails, before any `boot()`)
- `[@laratype/auth] Auth guard "<name>" is not defined in app/config/auth.ts.`
- `[@laratype/auth] No app container: use Auth, AuthGuard and AuthVerification inside a request served by RequestKernel.`
- `[@laratype/auth] AuthManager is not bound in the app container: boot PassportServiceProvider, which binds it from app/config/auth.ts.`
- `[@laratype/auth] Auth guard "<name>": a local strategy needs options.usernameField and options.passwordField.` (boot, also for an empty `''`)
- `[@laratype/auth] Auth guard "<name>": options.usernameField and options.passwordField must be different fields.` (boot)
- `[@laratype/auth] Auth guard "<name>": a local strategy does not support options.passReqToCallback.` (boot)
- `[@laratype/auth] <Model> hashes "<model passwordField>", not the guard's passwordField "<passwordField>": set static passwordField on the model, or use the same name in options.` (`attempt()`, before any query)
- `[@laratype/auth] <Model> has no "<passwordField>" column (the guard's passwordField)` (`attempt()`, when the provider model has no such column)
- `[@laratype/auth] Model <name> does not have a primary key defined.` (`verify()` and `issueToken()`, an `InternalException`: the provider model, or the model a token record names, has no primary column)
- `[@laratype/auth] Guard "<name>" issues tokens for <Provider.name>, not <Model.name>.` (`issueToken()`, an `InternalException`: the user is not an instance of the guard's provider)

`AuthGuard` keeps its two 401s: `Token is missing or invalid.` and `Token is invalid or expired.` (`code: "UNAUTHORIZED"`).

### Example
[`examples/auth/proposed/guards.ts`](./examples/auth/proposed/guards.ts). Executable spec: `packages/auth/__tests__/guards.test.ts` boots the app like `sauf dev` and runs the local, manual and admin logins of `examples/basic`, then the bearer 401s, the guard claim, the model claim, the HS256 pin and the guard identity of A6 #335 (`examples/basic` itself needs MySQL and Google credentials); `packages/auth/__tests__/login.test.ts` covers the password check of `attempt()` and `verifyLocal()`; `guards.test-d.ts` covers the types.

### Non-goals
- No session guard: the repo has no session support yet.
- No `extend()` or driver registry before F1 [#160](https://github.com/Laratypes/Laratype/issues/160).
- No change to the 0.5 config shape beyond the optional strategy fields, and no typed guard names (A1 [#119](https://github.com/Laratypes/Laratype/issues/119)).

### Open questions
- Resolved: the auth config comes from the manifest in `register()`, not from `config('auth')`, because K1 [#152](https://github.com/Laratypes/Laratype/issues/152) fills the store in `boot()`; see [Invariants](#invariants). Loading the configs before every `register()` would allow `config('auth')`.
- `AuthManager` on the shared driver `Manager` (F1 [#160](https://github.com/Laratypes/Laratype/issues/160)).
- Session guard: needs a session package (no issue yet; see [#151](https://github.com/Laratypes/Laratype/issues/151)).

### Acceptance
[#151 Done when](https://github.com/Laratypes/Laratype/issues/151)

---

## OAuth2 server

### Status
planned → [#179](https://github.com/Laratypes/Laratype/issues/179) (O1), [#180](https://github.com/Laratypes/Laratype/issues/180) (O2), both M4.

### Design (non-binding)
- **O1 grants:** authorization_code + PKCE, client_credentials and refresh, plus a token guard.
- **O2:** typed scopes, a client CLI and headless consent.

### Acceptance
[#179 Done when](https://github.com/Laratypes/Laratype/issues/179) · [#180 Done when](https://github.com/Laratypes/Laratype/issues/180)
