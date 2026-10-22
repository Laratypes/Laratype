import { isPlainObject } from "es-toolkit";

/**
 * Resource v2 (docs/v1/http.md › Resources, H9 #123): `defineResource(Model, fn)` maps a model to plain data with an
 * inferred output type. `.make`, `.collection` and `.paginate` return that data itself, so a handler returning it goes
 * through the route proof's return check against the contract's response schema, like any other value.
 */

// A registered symbol, so that two copies of this module (src and dist, two bundles) agree on what is missing
const MISSING_KEY: unique symbol = Symbol.for("laratype.resource.missing");

/** What `when()` gives for a false condition: `make` drops the key, so the output type has it optional. */
export interface MissingValue {
  readonly [MISSING_KEY]: true;
}

/** A top-level key the resource leaves out. Its `toJSON` also keeps it out of a nested object's JSON. */
const MISSING: MissingValue = Object.freeze({ [MISSING_KEY]: true as const, toJSON: () => undefined });

const isMissing = (value: unknown): boolean =>
  typeof value === "object" && value !== null && (value as Partial<MissingValue>)[MISSING_KEY] === true;

/**
 * The value, or no key at all when `condition` is false. The value is kept as it is (a function too): use a
 * conditional expression to compute it only when needed. Only the top-level keys of a resource are dropped: a nested
 * `when()` keeps `MissingValue` in the type.
 *
 *   email: when(user.isAdmin, user.email),
 */
export function when<V>(condition: boolean, value: V): V | MissingValue {
  return condition ? value : MISSING;
}

type ModelClass = abstract new (...args: any) => any;
type IsAny<X> = 0 extends 1 & X ? true : false;
type MayBeMissing<V> = IsAny<V> extends true ? false : [Extract<V, MissingValue>] extends [never] ? false : true;

/** The data `fn` returns, with each `when()` key optional and without `MissingValue`. */
export type ResourceOutput<R> = {
  [K in keyof R as MayBeMissing<R[K]> extends true ? never : K]: R[K];
} & {
  [K in keyof R as MayBeMissing<R[K]> extends true ? K : never]?: Exclude<R[K], MissingValue>;
} extends infer O ? { [K in keyof O]: O[K] } : never;

/**
 * What `fn` returns: a plain object (checked at runtime), never an array or a promise (load relations before `make`).
 * A `then` key is refused too: it would make the data a thenable.
 */
type ResourceData = object & { readonly then?: never; readonly [Symbol.iterator]?: never };

/** A plain page of models (`{ data, ...meta }`): `paginate` maps `data` and copies the page's other fields as they are. */
export type ResourcePage<P, Out> = P extends unknown
  ? Omit<P, "data"> & { data: Out[] } extends infer O ? { [K in keyof O]: O[K] } : never
  : never;

export interface Resource<M extends ModelClass, Out> {
  /** The data of one model. */
  make(model: InstanceType<M>): Out;
  /** The data of each model, in order. */
  collection(models: Iterable<InstanceType<M>>): Out[];
  /** A plain page object whose `data` holds the models: `{ data: Out[], ...meta }`. */
  paginate<P extends { readonly data: Iterable<InstanceType<M>> }>(page: P): ResourcePage<P, Out>;
}

const describe = (value: unknown): string =>
  typeof value !== "object" || value === null
    ? String(value)
    : `an instance of ${(value.constructor as { name?: string } | undefined)?.name || "an unnamed class"}`;

/**
 * A resource for `Model`: `fn` maps one instance to plain data, and its return type is the output type.
 * The model class types `fn`'s argument; it is not checked at runtime.
 *
 *   const UserResource = defineResource(User, (user) => ({
 *     id: user.id,
 *     email: when(user.isAdmin, user.email),
 *   }));
 *   UserResource.make(user);   // { id: number; email?: string }
 */
export function defineResource<M extends ModelClass, R extends ResourceData>(
  model: M,
  fn: (model: InstanceType<M>) => R,
): Resource<M, ResourceOutput<R>> {
  type Out = ResourceOutput<R>;
  const make = (instance: InstanceType<M>): Out => {
    const data: unknown = fn(instance);
    // A copy keeps own fields only: a class instance would lose its getters and send its private fields
    if (!isPlainObject(data)) {
      throw new TypeError(`[@laratype/http] ${model.name}: the resource function must return a plain object, got ${describe(data)}`);
    }
    // fromEntries defines own properties, so a `__proto__` key stays a key
    return Object.fromEntries(Object.entries(data).filter(([, value]) => !isMissing(value))) as Out;
  };

  return Object.freeze({
    make,
    collection: (models: Iterable<InstanceType<M>>) => Array.from(models, make),
    paginate: <P extends { readonly data: Iterable<InstanceType<M>> }>(page: P) => {
      if (!isPlainObject(page)) {
        throw new TypeError(`[@laratype/http] ${model.name}: paginate() takes a plain page object ({ data, ...meta }), got ${describe(page)}`);
      }
      return { ...page, data: Array.from(page.data, make) } as unknown as ResourcePage<P, Out>;
    },
  });
}
