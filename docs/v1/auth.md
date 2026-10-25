---
area: auth
packages: ["@laratype/auth"]
issues: [119, 120, 121, 122, 151, 179, 180, 228]
verified-against: Laratype@d70daa7
last-verified: 2026-10-09
---

# Auth (`@laratype/auth`), skeleton

> **Skeleton.** Every section is planned and no v1 auth code exists. `@laratype/auth` on master is the 0.5 package: guards in `packages/auth/src/guard` and `passport`, policies in `packages/auth/src/policies`, and gates in `packages/auth/src/gate`. This file lists the planned work and a short, non-binding design so that agents don't build against plan sketches. Signatures are added when the issues land.

| Section | Status |
|---|---|
| [Typed Register](#typed-register) | planned → #119 |
| [Authentication from the contract](#authentication-from-the-contract) | planned → #120, #228 |
| [Policies and gates](#policies-and-gates) | planned → #121 |
| [Guards in the container](#guards-in-the-container) | planned → #151 |
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
planned → [#151](https://github.com/Laratypes/Laratype/issues/151) (A4, M3).

### Design (non-binding)
The jwt, session and passport guards are resolved from the container and configured through typed config ([#152](https://github.com/Laratypes/Laratype/issues/152)). Done when the auth flows in `examples/basic` pass.

- **Token:** a token guard reads it with `request.bearerToken()` only, never from `Authorization` itself (A5 [#288](https://github.com/Laratypes/Laratype/issues/288), shipped in the 0.5 `AuthGuard`). It returns the token of `Authorization: Bearer <token>`, with the scheme in any case and the token an RFC 6750 b64token, else `""`, and the guard answers its 401.

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
