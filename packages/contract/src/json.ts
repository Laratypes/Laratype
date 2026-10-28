import type { Prettify } from "./path";

type NotJson = undefined | symbol | ((...args: any[]) => unknown);

/** An array item that JSON cannot hold becomes `null`, as `JSON.stringify` does. */
type JsonItem<T> = T extends NotJson ? null : Jsonify<T>;

/** A property JSON keeps: a string key whose value is not only `undefined`, functions or symbols. */
type JsonKey<T, K extends keyof T> = K extends symbol ? never : [Exclude<T[K], undefined>] extends [NotJson] ? never : K;

/**
 * An object's wire type. `JSON.stringify` drops a property whose value is `undefined`, so a property that may be
 * `undefined` (`x?: X` or `x: X | undefined`) is optional on the wire.
 */
type JsonObject<T> = Prettify<
  { -readonly [K in keyof T as undefined extends T[K] ? never : JsonKey<T, K>]: Jsonify<T[K]> } & {
    -readonly [K in keyof T as undefined extends T[K] ? JsonKey<T, K> : never]?: Jsonify<T[K]>;
  }
>;

/**
 * The wire type of a value after `JSON.stringify` + `JSON.parse` (#107, #110): `Date` → `string` (through `toJSON`),
 * `undefined` / functions / symbols are removed from unions and their properties dropped, a property that may be
 * `undefined` is optional, `bigint` → `never`, `Map` / `Set` → `{}`. The server serializes a response schema's output
 * with `JSON.stringify`, so the frontend reads it as `Jsonify<InferOut<schema>>`.
 */
export type Jsonify<T> = unknown extends T
  ? T
  : T extends { toJSON(...args: any[]): infer J }
    ? Jsonify<J>
    : T extends string | number | boolean | null
      ? T
      : T extends NotJson | bigint
        ? never
        : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
          ? {}
          : T extends readonly unknown[]
            ? { -readonly [K in keyof T]: JsonItem<T[K]> }
            : JsonObject<T>;
