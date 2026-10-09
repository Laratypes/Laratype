---
area: auth
packages: ["@laratype/auth"]
issues: [119, 120, 121, 122, 151, 179, 180]
verified-against: Laratype@d70daa7
last-verified: 2026-10-09
---

# Auth (`@laratype/auth`), skeleton

> **Skeleton.** Every section is planned and no v1 auth code exists. `@laratype/auth` on master is the 0.5 package: guards in `packages/auth/src/guard` and `passport`, policies in `packages/auth/src/policies`, and gates in `packages/auth/src/gate`. This file lists the planned work and a short, non-binding design so that agents don't build against plan sketches. Signatures are added when the issues land.

| Section | Status |
|---|---|
| [Typed Register](#typed-register) | planned → #119 |
| [auth() middleware](#auth-middleware) | planned → #120 |
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
- **Facade:** `Auth` becomes a container facade ([#115](https://github.com/Laratypes/Laratype/issues/115)).

### Acceptance
[#119 Done when](https://github.com/Laratypes/Laratype/issues/119)

---

## auth() middleware

### Status
planned → [#120](https://github.com/Laratypes/Laratype/issues/120) (A2, M2). Built on typed middleware, H6 [#117](https://github.com/Laratypes/Laratype/issues/117).

### Design (non-binding)
- **Context:** `auth('api')` adds `{ user }` to the handler context, typed from the selected guard.
- **Unauthenticated:** a 401 (`errors.unauthorized`).
- **Route proof:** a handler that requires `user` on a route without `auth()` is a compile error at `r.contract()` ([http.md › Route proof](./http.md#route-proof-at-rcontract)).

### Acceptance
[#120 Done when](https://github.com/Laratypes/Laratype/issues/120)

---

## Policies and gates

### Status
planned → [#121](https://github.com/Laratypes/Laratype/issues/121) (A3, M2). Route integration: [#122](https://github.com/Laratypes/Laratype/issues/122) (H8, [http.md › Policies on routes](./http.md#policies-on-routes-can)).

### Design (non-binding)
Abilities are `keyof Policy`, and `Gate.allows` and `user.can()` are typed. An unknown ability is a type error. This replaces the 0.5 string abilities.

### Acceptance
[#121 Done when](https://github.com/Laratypes/Laratype/issues/121)

---

## Guards in the container

### Status
planned → [#151](https://github.com/Laratypes/Laratype/issues/151) (A4, M3).

### Design (non-binding)
The jwt, session and passport guards are resolved from the container and configured through typed config ([#152](https://github.com/Laratypes/Laratype/issues/152)). Done when the auth flows in `examples/basic` pass.

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
