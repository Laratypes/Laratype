import type { Prettify } from "./path";

type NotJson = undefined | symbol | ((...args: any[]) => unknown);

/** An array item that JSON cannot hold becomes `null`, as `JSON.stringify` does. */
type JsonItem<T> = T extends NotJson ? null : Jsonify<T>;

/** A property JSON keeps: a string key whose value is not only `undefined`, functions or symbols. */
type JsonKey<T, K extends keyof T> = K extends symbol ? never : [Exclude<T[K], undefined>] extends [NotJson] ? never : K;

/**
 * An object's wire type. `JSON.stringify` drops a property whose value is `undefined`, so a property that may be
 * `undefined` (`x?: X` or `x: X | undefined`) is optional on the wire, without a `null`: only a top-level `undefined`
 * has no JSON text and is sent as `null` (`Jsonify`).
 */
type JsonObject<T> = Prettify<
  { -readonly [K in keyof T as undefined extends T[K] ? never : JsonKey<T, K>]: JsonValue<T[K]> } & {
    -readonly [K in keyof T as undefined extends T[K] ? JsonKey<T, K> : never]?: JsonValue<Exclude<T[K], undefined>>;
  }
>;

/**
 * The wire type of one JSON value after `JSON.stringify` + `JSON.parse` (#107, #110): `Date` → `string` (through
 * `toJSON`), `undefined` / functions / symbols are removed from unions and their properties dropped, `bigint` → `never`,
 * `Map` / `Set` → `{}`. A top-level `undefined` is `Jsonify`'s `null`, not this type.
 */
type JsonValue<T> = unknown extends T
  ? T
  : T extends { toJSON(...args: any[]): infer J }
    ? JsonValue<J>
    : T extends string | number | boolean | null
      ? T
      : T extends NotJson | bigint
        ? never
        : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
          ? {}
          : T extends readonly unknown[]
            ? { -readonly [K in keyof T]: JsonItem<T[K]> }
            : JsonObject<T>;

/**
 * The wire type of a response body after `JSON.stringify` + `JSON.parse` (#107, #110): `Date` → `string` (through
 * `toJSON`), `undefined` / functions / symbols are removed from unions, a property that may be `undefined` is optional
 * and dropped, `bigint` → `never`, `Map` / `Set` → `{}`. A top-level value JSON has no text for (`undefined`, and the
 * server's `null` for it) is `null`, so `Jsonify<string | undefined>` is `string | null` (H32 #312). The server serializes
 * a response schema's output with `JSON.stringify`, so the frontend reads it as `Jsonify<InferOut<schema>>`.
 */
export type Jsonify<T> = unknown extends T
  ? T
  : undefined extends T
    ? JsonValue<T> | null
    : JsonValue<T>;
