import type { Model } from "@laratype/database";

/**
 * The app's auth types, registered by module augmentation (docs/v1/auth.md › Typed Register):
 *
 * @example
 * declare module '@laratype/auth' {
 *   interface Register { user: User; guards: { web: true; api: true } }
 * }
 */
export interface Register {}

/**
 * The user the app registered as `Register['user']`, or `Model` before one registers it: `Auth.user()` returns
 * `Authenticated<RegisteredUser> | null`, and keeps its 0.5 `Authenticated<Model> | null` until then.
 */
export type RegisteredUser<R = Register> = R extends { user: infer U extends Model } ? U : Model;

/**
 * The app's guard names, `keyof Register['guards']`, or `string` before one registers them: `Auth.guard()` accepts
 * only these names, and any string until then.
 */
export type GuardName<R = Register> = R extends { guards: infer G } ? keyof G & string : string;

/**
 * The user type an app registers for guard `K` (A2 #120): `{ user: Admin }` gives `Admin`, `true` or no entry the
 * app's `RegisteredUser`. `true` (the default guard) gives the app's user; a route's resolved auth uses this too.
 */
export type GuardUser<A extends true | GuardName = true> =
  A extends true
    ? RegisteredUser
    : A extends GuardName
      ? Register extends { guards: infer G }
        ? A extends keyof G
          ? G[A] extends { user: infer U extends Model }
            ? U
            : RegisteredUser
          : RegisteredUser
        : RegisteredUser
      : never;
