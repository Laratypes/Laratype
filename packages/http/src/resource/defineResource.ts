/**
 * Resource v2 (docs/v1/http.md › Resources, H9 #123): `defineResource(Model, fn)` maps a model to plain data with an
 * inferred output type. `.make`, `.collection` and `.paginate` return that data itself, so a handler returning it goes
 * through the route proof's return check against the contract's response schema, like any other value.
 */

declare const missing: unique symbol;

/** What `when()` gives for a false condition: `make` drops the key, so the output type has it optional. */
export interface MissingValue {
  readonly [missing]: true;
}

// A registered symbol, so that two copies of this module (src and dist, two bundles) agree on what is missing
const MISSING_KEY = Symbol.for("laratype.resource.missing");

/** A top-level key the resource leaves out. Its `toJSON` also keeps it out of a nested object's JSON. */
const MISSING = Object.freeze({ [MISSING_KEY]: true, toJSON: () => undefined }) as unknown as MissingValue;

const isMissing = (value: unknown): boolean =>
  typeof value === "object" && value !== null && (value as { [MISSING_KEY]?: unknown })[MISSING_KEY] === true;

/** Any value but a function or a class: `when()` calls a function value, so it must take no arguments. */
type NotFunction = string | number | boolean | bigint | symbol | null | undefined | (object & { readonly call?: never });

/**
 * The value, or no key at all when `condition` is false. A function value is called only when the condition holds.
 * Only the top-level keys of a resource are dropped: a nested `when()` keeps `MissingValue` in the type.
 *
 *   isAdmin: when(user.isAdmin, true),
 *   secret: when(canSee, () => user.secret),
 */
export function when<V>(condition: boolean, value: () => V): V | MissingValue;
export function when<V extends NotFunction>(condition: boolean, value: V): V | MissingValue;
export function when<V>(condition: boolean, value: V | (() => V)): V | MissingValue {
  if (!condition) return MISSING;
  return typeof value === "function" ? (value as () => V)() : value;
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

/** What `fn` returns: a plain object (checked at runtime), never an array or a promise (load relations before `make`). */
type ResourceData = object & { readonly then?: never; readonly [Symbol.iterator]?: never };

/** A plain page of models (`{ data, ...meta }`): `paginate` maps `data` and copies the page's other fields as they are. */
export type ResourcePage<P, Out> = Omit<P, "data"> & { data: Out[] } extends infer O ? { [K in keyof O]: O[K] } : never;

export interface Resource<M extends ModelClass, Out> {
  /** The data of one model. */
  make(model: InstanceType<M>): Out;
  /** The data of each model, in order. */
  collection(models: Iterable<InstanceType<M>>): Out[];
  /** A plain page object whose `data` holds the models: `{ data: Out[], ...meta }`. */
  paginate<P extends { readonly data: Iterable<InstanceType<M>> }>(page: P): ResourcePage<P, Out>;
}

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const nameOf = (value: object): string => (value.constructor as { name?: string } | undefined)?.name || "an unnamed class";

/** The own enumerable fields of `data` without the missing ones, in a new object. */
const present = (data: object): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    const value = (data as Record<string, unknown>)[key];
    if (isMissing(value)) continue;
    // An assignment to `__proto__` would set the prototype: define it as an own key instead
    if (key === "__proto__") Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
    else out[key] = value;
  }
  return out;
};

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
    const data = fn(instance);
    // A copy keeps own fields only: a class instance would lose its getters and send its private fields
    if (!isPlainObject(data)) {
      throw new TypeError(`[@laratype/http] ${model.name}: the resource function must return a plain object, got an instance of ${nameOf(data)}`);
    }
    return present(data) as Out;
  };

  return Object.freeze({
    make,
    collection: (models: Iterable<InstanceType<M>>) => Array.from(models, make),
    paginate: <P extends { readonly data: Iterable<InstanceType<M>> }>(page: P) => {
      if (!isPlainObject(page)) {
        throw new TypeError(`[@laratype/http] ${model.name}: paginate() takes a plain page object ({ data, ...meta }), got an instance of ${nameOf(page)}`);
      }
      return { ...page, data: Array.from(page.data, make) } as unknown as ResourcePage<P, Out>;
    },
  });
}
