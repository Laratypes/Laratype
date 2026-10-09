import type { DepSlot, DepsEntry, DepsLookup, DepsMeta } from './deps'

/**
 * Own-property key for a class's constructor deps. `Symbol.for` so that two copies of
 * `@laratype/core` in one bundle still see each other's registrations.
 */
const DEPS = Symbol.for('laratype.di.deps')

/** Types `design:paramtypes` reports for things with no injectable runtime value (interfaces erase to `Object`). */
const UNINJECTABLE: ReadonlySet<unknown> = new Set([undefined, Object, String, Number, Boolean, Symbol, BigInt, Function, Array, Promise])

/**
 * Emitted by the DI build transform (T1) after each class with an own constructor, or wrapped
 * around a class expression: `__laratype_deps(Cls, [() => Dep | () => TOKEN | { unresolved, index }], { params, optional })`.
 * Stores the entry as an own property of `Cls` and returns `Cls` unchanged.
 */
export function __laratype_deps<T extends Function>(cls: T, slots: DepSlot[], meta?: DepsMeta): T {
  const entry: DepsEntry = meta ? { slots, meta } : { slots }
  // Configurable so a re-run of the same module (HMR) can register again.
  Object.defineProperty(cls, DEPS, { value: entry, configurable: true, enumerable: false, writable: false })
  return cls
}

/** Whether `cls` itself was registered (it has an own constructor that the transform saw). */
export function hasOwnDeps(cls: Function): boolean {
  return Object.prototype.hasOwnProperty.call(cls, DEPS)
}

type ReflectWithMetadata = typeof Reflect & { getOwnMetadata?: (key: unknown, target: object) => unknown }

/** `design:paramtypes` of `cls` itself (not inherited), when reflect-metadata is loaded and the class has it. */
const paramTypesEntry = (cls: Function): DepsEntry | undefined => {
  const getOwnMetadata = (Reflect as ReflectWithMetadata).getOwnMetadata
  if (typeof getOwnMetadata !== 'function') return undefined
  const types = getOwnMetadata.call(Reflect, 'design:paramtypes', cls)
  if (!Array.isArray(types)) return undefined
  return {
    slots: types.map((type: unknown, index): DepSlot =>
      UNINJECTABLE.has(type)
        ? { unresolved: typeof type === 'function' ? type.name : String(type), index }
        : () => type),
    meta: { params: [] },
  }
}

/**
 * Deps that apply to `cls`, and the class they were declared on.
 * Per class, starting at `cls`: its own registered entry, else its own `design:paramtypes`
 * (third-party decorated classes), else move to the parent. So a class with its own constructor
 * only ever uses its own params, and a class without one inherits the nearest ancestor's.
 */
export function getDeps(cls: Function): { owner: Function, entry: DepsEntry } | undefined {
  for (let c: unknown = cls; typeof c === 'function' && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    if (hasOwnDeps(c)) return { owner: c, entry: (c as unknown as Record<symbol, DepsEntry>)[DEPS] }
    const fallback = paramTypesEntry(c)
    if (fallback) return { owner: c, entry: fallback }
  }
  return undefined
}

/** `DepsLookup` backed by `__laratype_deps` registrations: `new Container({ deps: depsRegistry })`. */
export const depsRegistry: DepsLookup = {
  get: (cls) => getDeps(cls)?.entry,
}
