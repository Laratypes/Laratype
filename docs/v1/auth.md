---
area: auth
packages: ["@laratype/auth"]
issues: [119, 120, 121, 122, 151, 179, 180, 228, 335]
verified-against: Laratype@d70daa7
last-verified: 2026-10-09
---

# Auth (`@laratype/auth`), skeleton

> **Skeleton.** Every section but [Guards in the container](#guards-in-the-container) (proposed), [Typed Register](#typed-register) (proposed) and [Authentication from the contract](#authentication-from-the-contract) (proposed) is planned. `@laratype/auth` on master is the 0.5 package: guards in `packages/auth/src/guard` and `passport`, policies in `packages/auth/src/policies`, and gates in `packages/auth/src/gate`. This file lists the planned work and a short, non-binding design so that agents don't build against plan sketches. Signatures are added when the issues land.

| Section | Status |
|---|---|
| [Typed Register](#typed-register) | proposed: PR [#363](https://github.com/Laratypes/Laratype/pull/363) @ 2ecef6d → #119 |
| [Authentication from the contract](#authentication-from-the-contract) | proposed: PR <leader fills> @ 633d314 → #120 |
| [Policies and gates](#policies-and-gates) | planned → #121 |
| [Guards in the container](#guards-in-the-container) | merged @ ea7ab23; `attempt()` password check proposed: PR [#346](https://github.com/Laratypes/Laratype/pull/346) @ 74b7e8245a6f86832f6d048bb6a62ed79a33011e; guard claim, model claim, HS256 and guard identity proposed: PR [#358](https://github.com/Laratypes/Laratype/pull/358) @ f37c318ebfb442892b273bd23d40a6fffe55543d |
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
// A2 #120: `{ user: Admin }` gives Admin, `true` (or no entry) the app's RegisteredUser; `true` is the default guard.
export type GuardUser<A extends true | GuardName> = ...;
```

An app fills `Register` once, by module augmentation: `user` is its user model, and each guard is `true` (the app's
user) or `{ user: <model> }`. `Auth` and `AuthService` come from [`packages/auth/src/support/Auth.ts` @ 2ecef6d](https://github.com/Laratypes/Laratype/blob/2ecef6d/packages/auth/src/support/Auth.ts), `AuthManager` from [`packages/auth/src/guard/AuthManager.ts` @ 2ecef6d](https://github.com/Laratypes/Laratype/blob/2ecef6d/packages/auth/src/guard/AuthManager.ts), and `AuthVerification` from [`packages/auth/src/verifications/AuthVerification.ts` @ 2ecef6d](https://github.com/Laratypes/Laratype/blob/2ecef6d/packages/auth/src/verifications/AuthVerification.ts):

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
- **Registry values are `true` or `{ user }`.** The keys of `Register['guards']` type the names; A2 #120 reads each value to type `GuardUser`: `true` is the app's `RegisteredUser`, `{ user: Admin }` is `Admin`. `Auth.guard(name)` still returns `RegisteredUser` until its own generic reads the guard (A2 leaves the runtime APIs as they were).
- **Boundary with the contract.** `@laratype/contract` stays browser-pure and never imports `@laratype/auth`. A2 #120 links the two registries: `@laratype/auth` augments the contract's empty `AuthRegisterLink` with `{ user: RegisteredUser; guards: { [K in GuardName]: GuardUser<K> } }`, and the contract derives `GuardName` and `GuardUser<A>` from it (plus its own `GuardRegistry` for a contract-only app). The app writes `Register` once.

### Diagnostics
- **Wrong guard name (type-level).** `Auth.guard('nope')` (and the other guard-name APIs) fails with `Argument of type '"nope"' is not assignable to parameter of type '"api" | "web" | "admin"'`, naming the registered guards. `Auth.guard('web')` compiles.
- **Runtime.** The registry never replaces the runtime check: an unknown name that got past the types throws `[@laratype/auth] Auth guard "<name>" is not defined in app/config/auth.ts.` (`AuthManager`).
- **Missing registration.** No type error: `Auth.user()` is `Authenticated<Model> | null` (today's 0.5 type) and `Auth.guard('anything')` compiles, as in 0.5.

### Example
[`examples/auth/proposed/typed-register.ts`](./examples/auth/proposed/typed-register.ts); the type tests are `packages/auth/__tests__/typedRegister.test-d.ts` (registered) and `packages/auth/__tests__/typedRegister.test.ts` (the unregistered fixture).

### Non-goals
- No runtime registry check.
- No change to the contract's `GuardRegistry` or to `auth: '<guard>'` beyond A2's link: `auth: '<guard>'` accepts the names of both registries.
- `Auth.user()` does not return the bare model: the `Authenticated` wrapper stays.

### Open questions
- Resolved by A2 #120: `Register['guards']` is linked to the contract's `GuardRegistry` through `AuthRegisterLink` (auth may import contract, never the reverse).

### Acceptance
[#119 Done when](https://github.com/Laratypes/Laratype/issues/119)

---

## Authentication from the contract

### Status
proposed: PR <leader fills> @ 633d314 ([#120](https://github.com/Laratypes/Laratype/issues/120), A2, M2), with the contract types of [#228](https://github.com/Laratypes/Laratype/issues/228) (C4b). The link is `AuthRegisterLink` in [`packages/contract/src/capabilities.ts`](../../packages/contract/src/capabilities.ts); the enforcement is `auth()` and `registerContractAuth()` in [`packages/auth/src/contractAuth.ts`](../../packages/auth/src/contractAuth.ts) and [`packages/http/src/routing/api/contractAuth.ts`](../../packages/http/src/routing/api/contractAuth.ts).

### Public API

```ts
// @laratype/contract: the link auth fills once, and what it derives
export interface GuardRegistry {}                        // contract-only apps: declare module '@laratype/contract' { interface GuardRegistry { api: true } }
export interface AuthRegisterLink {}                     // empty here; @laratype/auth augments it
export type GuardName = (keyof GuardRegistry & string) | (AuthRegisterLink extends { guards: infer G } ? keyof G & string : never);
type LinkedUser = AuthRegisterLink extends { user: infer U } ? U : unknown;
type LinkedGuards = AuthRegisterLink extends { guards: infer G } ? G : {};
export type GuardUser<A = AuthOption> = A extends true ? LinkedUser : A extends string ? (A extends keyof LinkedGuards ? LinkedGuards[A] : LinkedUser) : never;
export type AuthOption = true | GuardName;

// @laratype/http: the slot @laratype/auth fills on import (internal; the public API is the two functions)
const CONTRACT_AUTH: unique symbol;                      // Symbol.for('laratype.http.contractAuth')
export type ContractAuthFactory = (guard: true | string) => TypedMiddleware;
export function registerContractAuth(factory: ContractAuthFactory): void;
export function contractAuth(): ContractAuthFactory | undefined;   // undefined unless the slot holds a function

// @laratype/auth
export const auth: <G extends true | GuardName = true>(guard?: G) => TypedMiddleware<{ user: GuardUser<G> }>;

declare module '@laratype/contract' {                    // done by @laratype/auth on import
  interface AuthRegisterLink {
    user: RegisteredUser;
    guards: { [K in GuardName]: GuardUser<K> };
  }
}
```

The app writes `Register` once (auth.md › Typed Register): `guards: { web: true; api: true; admin: { user: Admin } }`. `web` and `api` resolve to `Register['user']`; `admin` to `Admin`. `Route.api` reads the contract's resolved `auth` and prepends the middleware at `mount()`; an API route writes no `.middleware(auth())`.

### Invariants
- **Declared in the contract, applied by the framework.** `auth: true | '<guard>'` on a scope, a contract or an endpoint; the nearest level wins, and `.public()` opts the endpoint out ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)). `true` is the default guard of `app/config/auth.ts`.
- **Order.** `mount()` prepends the auth middleware to the route pipeline, before the route middleware (a short-circuit cannot skip it), before `r.bind()` bindings, before input validation and before the handler. A 401 therefore comes before a 404 or a 422, and never says whether a row exists. `RouteEntry.middleware` stays what the app declared.
- **Fail closed.** A route whose resolved auth is set while no factory is registered fails `mount()`: `[@laratype/http] Route.api: <route name>: the contract declares auth, but @laratype/auth is not imported.` Importing `@laratype/auth` is what makes enforcement available.
- **The slot is untrusted.** `contractAuth()` returns the `Symbol.for('laratype.http.contractAuth')` value only when it is a function; anything else behaves as "not imported", so `mount()` fails closed. `registerContractAuth()` accepts the same factory twice; `@laratype/auth` brands its factory (`Symbol.for('laratype.auth.contractAuthFactory')`, non-enumerable and read-only), so a branded factory replaces another branded one (last wins: a reloaded module or a second copy of the package) while any other different function throws and a non-function value is replaced. The brand is not a security boundary (any in-process code can set it): it only tells a second copy of `@laratype/auth` from an unrelated value.
- **One registry.** `@laratype/auth` augments the contract's `AuthRegisterLink`; `GuardRegistry` alone still works for a contract-only app (its guard names type `auth: '<guard>'`, and its user type is `unknown`). The contract stays browser-pure and imports nothing from auth; auth imports `@laratype/contract` and throws its derived `errors.unauthorized()`.
- **Runtime.** `authManager().guard(auth === true ? undefined : auth).user(request)`. No user: throw the derived 401 `{ code: 'UNAUTHORIZED', message: 'Unauthenticated.' }`. Otherwise `setAuthenticatedUser(user, guard.name)` (A6 #335: `Auth.user()` / `Auth.login()` sign for the authenticating guard), then `next({ user })`.
- **Types.** Per endpoint the route proof adds `{ user: GuardUser<ResolvedAuth<...>> }` to the provided context, and nothing on a public route. Route middleware extensions still win, last wins, as at runtime. A handler that requires `user` on a route without auth gets its own diagnosis, and a `user` of another type than the guard's is reported at the guard (Diagnostics).
- **`auth()` elsewhere.** The same middleware works on an ad-hoc route (`r.middleware(auth('api')).get(...)`) and in a manual `RequestKernel.handle({ middleware: [auth('api')] })`.
- **0.5 routes are unchanged:** they keep `AuthGuard` and its two 401s.

### Diagnostics
- `` <c>.<e>: handler requires `user`, route has no auth (add auth: true or a guard to the endpoint, its contract or a scope) `` (type-level, the route proof)
- `` <c>.<e>: `user` of the ctx does not match the guard's user type (the auth capability's guard) `` (type-level, the route proof)
- `[@laratype/http] Route.api: <route name>: the contract declares auth, but @laratype/auth is not imported.` (`mount()`; fail closed)
- `[@laratype/http] registerContractAuth(): the contract auth factory is already registered (<factory>), so a second, different factory would replace it. Fix: import @laratype/auth once, or remove the other package that registers the slot.` (at import of a second, different factory)
- A wrong guard name (`auth: 'nope'`) is the existing argument error that names the registered guards, and the runtime `[@laratype/auth] Auth guard "<name>" is not defined in app/config/auth.ts.` (AuthManager).

### Example
[`examples/auth/proposed/contract-auth.ts`](./examples/auth/proposed/contract-auth.ts). Runtime tests: [`packages/auth/__tests__/contractAuth.test.ts`](../../packages/auth/__tests__/contractAuth.test.ts) (401 without a user, a named guard, `.public()`, the nearest level, `Auth.user()` / `Auth.login()` guard identity, 401 before 422 and before route middleware, a scope guard, the ad-hoc/manual use, a second evaluation of the module) and [`packages/http/__tests__/routing/contractAuth.test.ts`](../../packages/http/__tests__/routing/contractAuth.test.ts) (fail closed, the untrusted slot, the same/different factory, the branded replacement, the middleware order, `.public()`); type tests: `packages/http/__tests__/routing/contractAuth.test-d.ts` and `packages/auth/__tests__/typedRegister.test-d.ts`.

### Non-goals
- No policy execution: `authorize` stays not enforced (#121).
- No model binding: `r.bind()` is H7 #118.
- No 403 from the guard: an unverified or locked account is a domain error the guard throws, declared with `throws` ([contract.md › Domain errors](./contract.md#domain-errors)).

### Acceptance
[#120 Done when](https://github.com/Laratypes/Laratype/issues/120)

---

## Policies and gates

### Status
planned → [#121](https://github.com/Laratypes/Laratype/issues/121) (A3, M2). Route integration: [#105](https://github.com/Laratypes/Laratype/issues/105) ([http.md › Authorization from the contract](./http.md#authorization-from-the-contract)), which supersedes [#122](https://github.com/Laratypes/Laratype/issues/122) (H8).

### Design (non-binding)
Abilities are `keyof Policy`, and `Gate.allows` and `user.can()` are typed. An unknown ability is a type error. This replaces the 0.5 string abilities.

Two mechanisms stay side by side:
- **`{ policy }`** on `r.scope()` and `r.contract()` drives the `authorize` capability and its compile check ([http.md › Authorization from the contract](./http.md#authorization-from-the-contract)).
- **`Gate.policy(Model, Policy)`** in a service provider links a policy to its model for imperative checks, such as `user.can('update', post)` in a service, as in Laravel's `Gate::policy` ([#121](https://github.com/Laratypes/Laratype/issues/121)).

A scope policy can define `before(user, params)` for the check shared by every endpoint under the scope.

### Acceptance
[#121 Done when](https://github.com/Laratypes/Laratype/issues/121)

---

## Guards in the container

### Status
merged @ ea7ab23 ([#151](https://github.com/Laratypes/Laratype/issues/151), A4, M3), on top of #330's guards. The `attempt()` password check is proposed: PR [#346](https://github.com/Laratypes/Laratype/pull/346) @ 74b7e8245a6f86832f6d048bb6a62ed79a33011e; the guard claim, model claim, HS256 and guard identity are proposed: PR [#358](https://github.com/Laratypes/Laratype/pull/358) @ f37c318ebfb442892b273bd23d40a6fffe55543d. The auth config is bound in `register()` from the app manifest, not through `config('auth')`, because K1 [#152](https://github.com/Laratypes/Laratype/issues/152) fills the config store after every `register()` (see [Invariants](#invariants)). The shared driver `Manager` stays F1 [#160](https://github.com/Laratypes/Laratype/issues/160), and the session guard needs a session package; see the [Open questions](#open-questions).

### Public API
[`packages/auth/src/guard/` @ 2103dbf81e0109a8d0b5f70f022013ebd8831f15](https://github.com/Laratypes/Laratype/tree/2103dbf81e0109a8d0b5f70f022013ebd8831f15/packages/auth/src/guard) (`AuthManager.ts`, `TokenGuard.ts`, `PassportGuard.ts`, `tokens.ts`), exported from `@laratype/auth`; the D8 facade `Auth` and its `AuthService` come from [`packages/auth/src/support/Auth.ts` @ ea7ab23](https://github.com/Laratypes/Laratype/blob/ea7ab23091a211129d1c95822eac5275eb66f74b/packages/auth/src/support/Auth.ts).

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
  attempt(fields: Record<string, any>): Promise<User | null>;  // Hash.check() after the lookup; the password is never a WHERE value
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
- **Passport:** `PassportServiceProvider.boot()` registers the strategy of every `PassportGuard` under the guard's name, so `Passport.authenticate('<guard>')` runs it. The local strategy's verify callback calls the guard's `attempt()` with `options.usernameField` and `options.passwordField`; another strategy fails with `Strategy not implemented`, as in 0.5. `attempt()` takes the password out of the fields by `options.passwordField` (the provider model's `static passwordField` when the option is not set, `password` by default), looks the user up by the remaining fields only, with the password column added to the select, and then checks the password with `Hash.check()`: a salted hash can't be matched in the query, so the password is never a WHERE value. The lookup values may be strings, booleans or finite numbers, and the password must be a string; at least one lookup field must remain after the password is taken out, and another value (an object, an array, `null`, `NaN`, an infinity) fails as an invalid credential before any query. The model hashes its own credential column ([database.md › Model](./database.md#model)), so a guard whose `options.passwordField` names a different field throws before any query. An unknown user still runs one check against a dummy hash. A successful login replaces a hash from an older format (`needsRehash()`), and a failed replacement still logs the user in. The returned user keeps the password when the column is selectable, as a plain lookup does, and has no password key when it is `{ select: false }`, so a provider that must not hand it back marks the column that way. `options.passwordField` is an entity property name, the one `findColumnWithPropertyName()` takes. `options` is optional since A4 (token guards have none); a local guard needs both `usernameField` and `passwordField`, and they must be different fields, because the verify callback looks the user up by exactly those keys and takes the password out of them, so `PassportServiceProvider.boot()` throws for a local guard that lacks one, sets one to `''`, or gives them the same name (see Diagnostics). The verify callback takes `(username, password, done)`, so a local guard with `options.passReqToCallback` throws at boot too.
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
