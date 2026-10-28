---
area: auth
packages: ["@laratype/auth"]
issues: [119, 120, 121, 122, 151, 179, 180, 228]
verified-against: Laratype@d70daa7
last-verified: 2026-10-09
---

# Auth (`@laratype/auth`), skeleton

> **Skeleton.** Every section but [Guards in the container](#guards-in-the-container) (proposed) is planned. `@laratype/auth` on master is the 0.5 package: guards in `packages/auth/src/guard` and `passport`, policies in `packages/auth/src/policies`, and gates in `packages/auth/src/gate`. This file lists the planned work and a short, non-binding design so that agents don't build against plan sketches. Signatures are added when the issues land.

| Section | Status |
|---|---|
| [Typed Register](#typed-register) | planned → #119 |
| [Authentication from the contract](#authentication-from-the-contract) | planned → #120, #228 |
| [Policies and gates](#policies-and-gates) | planned → #121 |
| [Guards in the container](#guards-in-the-container) | proposed: PR #346 @ a78e410 |
| [OAuth2 server](#oauth2-server) | planned → #179, #180 |

---

## Typed Register

### Status
planned → [#119](https://github.com/Laratypes/Laratype/issues/119) (A1, M2).

### Design (non-binding)
- **Typing:** module augmentation, quoted from #119:
  ```ts
  declare module '@laratype/auth' { interface Register { user: User; guards: { /* ... */ } } }
  ```
- **Effect:** `Auth.user()` is then typed `User | null`, which removes the 0.5 `Auth.user<User>()` casts.
- **Guard names:** `guards` is the registry that types `auth: '<guard>'` in contracts ([Authentication from the contract](#authentication-from-the-contract)).
- **Facade:** `Auth` becomes a container facade ([#115](https://github.com/Laratypes/Laratype/issues/115)).

### Acceptance
[#119 Done when](https://github.com/Laratypes/Laratype/issues/119)

---

## Authentication from the contract

### Status
planned → [#120](https://github.com/Laratypes/Laratype/issues/120) (A2, M2), with the contract types in [#228](https://github.com/Laratypes/Laratype/issues/228) (C4b).

### Design (non-binding)
- **Declared in the contract:** `auth: true | '<guard>'` on a scope, a contract or an endpoint. `true` uses the default guard. The nearest level wins, and `.public()` opts an endpoint out ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)).
- **Applied by the framework:** the guard runs from the contract. API routes don't use `.middleware(auth())`.
- **Guard names** are typed from the app's guard registry ([Typed Register](#typed-register), [#119](https://github.com/Laratypes/Laratype/issues/119)).
- **Context:** `ctx.user` is typed per guard ([http.md › Controller typing](./http.md#controller-typing-ctx-and-controllerof)).
- **Unauthenticated:** a 401 (`errors.unauthorized`).
- **Other 403s from auth:** an unverified or locked account is a domain error, for example `defineError(403, 'EMAIL_NOT_VERIFIED')`. The guard throws it, and the contract or scope declares it with `throws` ([contract.md › Domain errors](./contract.md#domain-errors)).

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
proposed: PR #346 @ a78e410 ([#151](https://github.com/Laratypes/Laratype/issues/151), A4, M3), on top of #330's guards. The auth config is bound in `register()` from the app manifest, not through `config('auth')`, because K1 [#152](https://github.com/Laratypes/Laratype/issues/152) fills the config store after every `register()` (see [Invariants](#invariants)). The shared driver `Manager` stays F1 [#160](https://github.com/Laratypes/Laratype/issues/160), and the session guard needs a session package; see the [Open questions](#open-questions).

### Public API
[`packages/auth/src/guard/` @ a78e410](https://github.com/Laratypes/Laratype/tree/a78e410f99067248975d5f9f7c8e05ad6173a2a3/packages/auth/src/guard) (`AuthManager.ts`, `TokenGuard.ts`, `PassportGuard.ts`, `tokens.ts`), exported from `@laratype/auth`; the D8 facade `Auth` and its `AuthService` come from [`packages/auth/src/support/Auth.ts` @ a78e410](https://github.com/Laratypes/Laratype/blob/a78e410f99067248975d5f9f7c8e05ad6173a2a3/packages/auth/src/support/Auth.ts).

```ts
// @laratype/auth
export const AUTH_CONFIG: InjectionToken<LaratypeConfig.Auth>;
export type GuardConfig = LaratypeConfig.Auth['guards'][string];
export type JWTSignOptions = { expiresIn?: number; name: string; abilities: string };

export class AuthManager {                                  // singleton in the app container
  constructor(config: LaratypeConfig.Auth, tokenModel?: typeof Model);
  readonly config: LaratypeConfig.Auth;
  get defaultGuard(): string;                               // config.default.guard
  guard<User = any>(name?: string): TokenGuard<User>;       // cached per name; default guard when omitted
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

The 0.5 API keeps its signatures and resolves its guards from the request's container: `Auth.guard(name)`, `Auth.user()`, `Auth.login()`, `AuthVerification.guard(name)` (now returns the `TokenGuard`), `AuthVerification.verify(token)`, `AuthGuard` and `Passport.authenticate(name)`. `Auth` is D8's facade ([di.md › Container-backed registries and facades](./di.md#container-backed-registries-and-facades)) over the stateless `AuthService`, which builds a per-guard handle for each of those calls.

### Invariants
- **Binding:** `PassportServiceProvider.register()` loads `app/config/auth.ts` and the `PersonalAccessToken` model from the app manifest, binds the config to `AUTH_CONFIG` with `instance()`, and binds `AuthManager` as a singleton. Both are available in every provider's `boot()`. `register()` runs before any `boot()`, so K1's [`config('auth')`](./config.md) store is not filled yet: the config comes from the manifest, and K1's `ConfigLoadServiceProvider` then loads the same module (the runtime's module cache), so both hold one object. The auth config may read `Env.get()`, and `EnvLoadServiceProvider` loads the env file only in its `boot()`, after every `register()`: `PassportServiceProvider.register()` loads it first, so `auth.ts` never reads an env file it has not loaded. An `app/config/env.ts` schema is validated in `EnvLoadServiceProvider.boot()`, after `auth.ts` was evaluated, so a value that fails the schema has already been read; the boot still fails there, before any provider's `boot()` runs the app ([config.md › Environment validation](./config.md#environment-validation)).
- **Drivers:** `guard(name)` builds a `PassportGuard` when the guard's config has a `strategy`, else a `TokenGuard`. A guard is built once per name and cached by the manager. There is no `extend()`: custom drivers come with the shared `Manager` (F1 [#160](https://github.com/Laratypes/Laratype/issues/160)).
- **Passport:** `PassportServiceProvider.boot()` registers the strategy of every `PassportGuard` under the guard's name, so `Passport.authenticate('<guard>')` runs it. The local strategy's verify callback calls the guard's `attempt()` with `options.usernameField` and `options.passwordField`; another strategy fails with `Strategy not implemented`, as in 0.5. `attempt()` takes the password out of the fields by `options.passwordField` (`password` by default), looks the user up by the remaining fields only, with the password column added to the select, and then checks the password with `Hash.check()`: a salted hash can't be matched in the query, so the password is never a WHERE value. Every lookup value and the password must be a string, and at least one lookup field must remain after the password is taken out; another value (an object, an array, a number) fails as an invalid credential before any query. An unknown user still runs one `check()` against a dummy hash. A successful login replaces a hash from an older format (`needsRehash()`), and a failed replacement still logs the user in. The returned user keeps the password when the column is selectable, as a plain lookup does, and has no password key when it is `{ select: false }`, so a provider that must not hand it back marks the column that way. `options.passwordField` is an entity property name, the one `findColumnWithPropertyName()` takes. `options` is optional since A4 (token guards have none); a local guard needs both `usernameField` and `passwordField`, because the verify callback looks the user up by exactly those keys, so `PassportServiceProvider.boot()` throws for a local guard that lacks one or sets one to `''` (see Diagnostics). The verify callback takes `(username, password, done)`, so a local guard with `options.passReqToCallback` throws at boot too.
- **Token:** a token guard reads it with `request.bearerToken()` only, never from `Authorization` itself (A5 [#288](https://github.com/Laratypes/Laratype/issues/288), shipped in the 0.5 `AuthGuard`). It returns the token of `Authorization: Bearer <token>`, with the scheme in any case and the token an RFC 6750 b64token, else `""`, and the guard answers its 401.
- **Verification:** with a `PersonalAccessToken` model, a token must have a record whose `expires_at` is in the future; the record's `verification_type` picks the verifier, and its `tokenable_type` and `tokenable_id` load the user. Without the model, `verify()` returns the decoded JWT. Only `jwt` is implemented: another `verification`, or a record whose `verification_type` is not `jwt`, throws `UnsupportedVerificationModeException` (`code: "UNSUPPORT_VERIFICATION_MODE"`).
- **Resolution:** `Auth`, `AuthGuard` and `AuthVerification` resolve `AuthManager` from the container of the current request (`ContextApi.getContainer()`); `Auth` does it through D8's facade and `AuthService`. `Passport.authenticate(name)` runs the strategy that `PassportServiceProvider.boot()` registered under that name. There is no global guard state: `globalThis.__laratype_auth_config` and `__laratype_auth_model_verify` are removed.
- **Outside a request** resolving a guard throws (see Diagnostics); `Auth.guard(name)` resolves it lazily, on `attempt()` or `login()`, and `Auth.user()` answers `null` because no user is authenticated. Code outside a request resolves `AuthManager` from the container it has, such as a provider's `this.app`.

### Diagnostics
`Error` messages (exact text):
- `app/config/auth.ts not found: the app manifest has no auth config` (`register()` fails, before any `boot()`)
- `[@laratype/auth] Auth guard "<name>" is not defined in app/config/auth.ts.`
- `[@laratype/auth] No app container: use Auth, AuthGuard and AuthVerification inside a request served by RequestKernel.`
- `[@laratype/auth] AuthManager is not bound in the app container: boot PassportServiceProvider, which binds it from app/config/auth.ts.`
- `[@laratype/auth] Auth guard "<name>": a local strategy needs options.usernameField and options.passwordField.` (boot, also for an empty `''`)
- `[@laratype/auth] Auth guard "<name>": a local strategy does not support options.passReqToCallback.` (boot)
- `[@laratype/auth] <Model> has no "<passwordField>" column (the guard's passwordField)` (`attempt()`, when the provider model has no such column)

`AuthGuard` keeps its two 401s: `Token is missing or invalid.` and `Token is invalid or expired.` (`code: "UNAUTHORIZED"`).

### Example
[`examples/auth/proposed/guards.ts`](./examples/auth/proposed/guards.ts). Executable spec: `packages/auth/__tests__/guards.test.ts` boots the app like `sauf dev` and runs the local, manual and admin logins of `examples/basic`, then the bearer 401s (`examples/basic` itself needs MySQL and Google credentials); `packages/auth/__tests__/login.test.ts` covers the password check of `attempt()` and `verifyLocal()`; `guards.test-d.ts` covers the types.

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
