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

/** A top-level key the resource leaves out. Its `toJSON` also keeps it off the wire if one ends up nested. */
const MISSING = Object.freeze({ toJSON: () => undefined }) as unknown as MissingValue;

/**
 * The value, or no key at all when `condition` is false. A function value is called only when the condition holds.
 * Only the top-level keys of a resource are dropped: a nested `when()` keeps `MissingValue` in the type.
 *
 *   isAdmin: when(user.isAdmin, true),
 *   secret: when(canSee, () => user.secret),
 */
export function when<V>(condition: boolean, value: () => V): V | MissingValue;
export function when<V>(condition: boolean, value: V): V | MissingValue;
export function when<V>(condition: boolean, value: V | (() => V)): V | MissingValue {
  if (!condition) return MISSING;
  return typeof value === "function" ? (value as () => V)() : value;
}

type ModelClass = abstract new (...args: any) => any;
type IsAny<X> = 0 extends 1 & X ? true : false;
type MayBeMissing<V> = IsAny<V> extends true ? false : MissingValue extends V ? true : false;

/** The data `fn` returns, with each `when()` key optional and without `MissingValue`. */
export type ResourceOutput<R> = {
  [K in keyof R as MayBeMissing<R[K]> extends true ? never : K]: R[K];
} & {
  [K in keyof R as MayBeMissing<R[K]> extends true ? K : never]?: Exclude<R[K], MissingValue>;
} extends infer O ? { [K in keyof O]: O[K] } : never;

/** A page of models (`{ data, ...meta }`): `paginate` maps `data` and copies the page's other own fields as they are. */
export type ResourcePage<P, Out> = Omit<P, "data"> & { data: Out[] } extends infer O ? { [K in keyof O]: O[K] } : never;

export interface Resource<M extends ModelClass, Out> {
  /** The data of one model. */
  make(model: InstanceType<M>): Out;
  /** The data of each model, in order. */
  collection(models: Iterable<InstanceType<M>>): Out[];
  /** A page whose `data` holds the models: `{ data: Out[], ...meta }`. */
  paginate<P extends { readonly data: Iterable<InstanceType<M>> }>(page: P): ResourcePage<P, Out>;
}

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
export function defineResource<M extends ModelClass, R extends Record<string, unknown>>(
  model: M,
  fn: (model: InstanceType<M>) => R,
): Resource<M, ResourceOutput<R>> {
  type Out = ResourceOutput<R>;
  // fromEntries defines own properties, so a `__proto__` key stays a key
  const make = (instance: InstanceType<M>): Out =>
    Object.fromEntries(Object.entries(fn(instance)).filter(([, value]) => value !== MISSING)) as Out;

  return Object.freeze({
    make,
    collection: (models: Iterable<InstanceType<M>>) => Array.from(models, (instance) => make(instance)),
    paginate: <P extends { readonly data: Iterable<InstanceType<M>> }>(page: P) =>
      ({ ...page, data: Array.from(page.data, (instance) => make(instance)) }) as unknown as ResourcePage<P, Out>,
  });
}
