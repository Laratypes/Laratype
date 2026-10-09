/**
 * Constructor dependency metadata as emitted by the build transform (S3):
 * `__laratype_deps(Cls, [() => Dep | () => TOKEN | { unresolved, index }], { params, optional })`.
 * The registry that stores it (and its parent-chain lookup) lives behind `DepsLookup`.
 */
export interface UnresolvedSlot {
  unresolved: string
  index: number
}

/** One slot per constructor param: a lazy thunk to the dependency key, or a marker for a type with no runtime value. */
export type DepSlot = (() => unknown) | UnresolvedSlot

export interface DepsMeta {
  params: string[]
  optional?: number[]
}

export interface DepsEntry {
  slots: DepSlot[]
  meta?: DepsMeta
}

/**
 * Where the container reads constructor deps from. `get` returns the entry that applies to `cls`
 * (own entry, or the inherited one when `cls` has no own constructor), or `undefined` if there is none.
 * A `Map` / `WeakMap<Function, DepsEntry>` satisfies it.
 */
export interface DepsLookup {
  get(cls: Function): DepsEntry | undefined
}

/** Default lookup: no metadata, so only zero-arg classes can be autowired. */
export const noDeps: DepsLookup = {
  get: () => undefined,
}
