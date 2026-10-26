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

type IsAny<X> = 0 extends 1 & X ? true : false;

/**
 * Every concrete value type: `unknown` is not assignable to any of them, so it does not satisfy the constraint of
 * `when()`. A conditional (`unknown extends V`) would be deferred for a generic `V`, and `V & <deferred>` does not
 * accept `V`; a constraint is checked on `V`'s own constraint, so a generic `T` works.
 */
type ConcreteValue = object | string | number | boolean | bigint | symbol | null | undefined;

/** `never` for an `any` value: `V | MissingValue` would collapse to it, and the key would look required. */
type KnownValue<V> = IsAny<V> extends true ? never : unknown;

/**
 * The value, or no key at all when `condition` is false. The value is kept as it is (a function too): use a
 * conditional expression to compute it only when needed. Only the top-level keys of a resource are dropped: a nested
 * `when()` keeps `MissingValue` in the type. The value needs a concrete type, a generic `T` included: an `any` or
 * `unknown` value does not compile.
 *
 *   email: when(user.isAdmin, user.email),
 */
export function when<V extends ConcreteValue>(condition: boolean, value: V & KnownValue<V>): V | MissingValue {
  return condition ? value : MISSING;
}

type ModelClass = abstract new (...args: any) => any;
type MayBeMissing<V> = IsAny<V> extends true ? false : [Extract<V, MissingValue>] extends [never] ? false : true;

/**
 * The data `fn` returns, with each `when()` key optional and without `MissingValue`. A union return keeps one output
 * object per member, so a discriminated union's output narrows per member.
 */
export type ResourceOutput<R> = R extends unknown
  ? {
      [K in keyof R as MayBeMissing<R[K]> extends true ? never : K]: R[K];
    } & {
      [K in keyof R as MayBeMissing<R[K]> extends true ? K : never]?: Exclude<R[K], MissingValue>;
    } extends infer O
    ? { [K in keyof O]: O[K] }
    : never
  : never;

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
  typeof value === "function"
    ? "a function"
    : typeof value !== "object" || value === null
      ? String(value)
      : `an instance of ${(value.constructor as { name?: string } | undefined)?.name || "an unnamed class"}`;

const isIterable = (value: unknown): value is Iterable<unknown> =>
  value != null && typeof (value as Iterable<unknown>)[Symbol.iterator] === "function";

/**
 * The keys `make` refuses, and why: a `toJSON` key makes JSON.stringify send its result instead of the mapped data the
 * contract checked, and a `constructor` key makes the 0.5 `ResponseSupport.shouldBeJson()` send the body as text/html.
 */
const RESERVED_KEYS: ReadonlyMap<string, string> = new Map([
  ["toJSON", "JSON.stringify would send its result instead of the resource data"],
  ["constructor", "the body would be sent as text/html instead of JSON"],
]);

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
    const keys = Reflect.ownKeys(data).filter((key) => Object.prototype.propertyIsEnumerable.call(data, key));
    for (const key of keys) {
      const reason = typeof key === "string" ? RESERVED_KEYS.get(key) : undefined;
      if (reason !== undefined) {
        throw new TypeError(`[@laratype/http] ${model.name}: the resource function must not return a ${String(key)} key: ${reason}`);
      }
    }
    // fromEntries defines own properties, so a `__proto__` key stays a key; own keys include symbol keys
    const entries = keys.map((key) => [key, data[key]] as const).filter(([, value]) => !isMissing(value));
    return Object.fromEntries(entries) as Out;
  };

  return Object.freeze({
    make,
    collection: (models: Iterable<InstanceType<M>>) => Array.from(models, make),
    paginate: <P extends { readonly data: Iterable<InstanceType<M>> }>(page: P) => {
      if (!isPlainObject(page)) {
        throw new TypeError(`[@laratype/http] ${model.name}: paginate() takes a plain page object ({ data, ...meta }), got ${describe(page)}`);
      }
      if (!isIterable(page.data)) {
        throw new TypeError(`[@laratype/http] ${model.name}: paginate() takes a page whose data holds the models, got data ${describe(page.data)}`);
      }
      return { ...page, data: Array.from(page.data, make) } as unknown as ResourcePage<P, Out>;
    },
  });
}
