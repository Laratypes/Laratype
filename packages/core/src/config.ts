/**
 * The app's config files, registered by module augmentation (docs/v1/config.md › Config files and config()):
 *
 * @example
 * import type database from './database'
 * declare module '@laratype/core' {
 *   interface Register { config: { database: typeof database } }
 * }
 */
export interface Register {}

/** The registered configs, by file name; any string path before an app registers them. */
export type AppConfigs = Register extends { config: infer C } ? C : Record<string, unknown>

type Key = string | number

/** Paths stop at arrays, functions and classes, and after 8 levels so big option types stay cheap to check. */
type Stop = readonly unknown[] | ((...args: never[]) => unknown) | (abstract new (...args: never[]) => unknown)

/**
 * Every dot path of `T`: `"database" | "database.default" | ...`. A key that contains a dot ends a path: the lookup
 * reads it as the whole rest of the path.
 */
export type ConfigPath<T = AppConfigs, Depth extends unknown[] = []> = Depth['length'] extends 8
  ? never
  : T extends Stop
    ? never
    : T extends object
      ? {
          [K in keyof T & Key]-?: `${K}` | (`${K}` extends `${string}.${string}` ? never : `${K}.${ConfigPath<NonNullable<T[K]>, [...Depth, unknown]>}`)
        }[keyof T & Key]
      : never

/** The keys of `T` but its index signatures. */
type LiteralKey<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: 0 }

/** A key read through an index signature (`Record<string, X>`) may be missing. */
type Missing<T> = string extends keyof T ? undefined : number extends keyof T ? undefined : never

/**
 * The value at dot path `P` of `T`; `| undefined` when a key on the path is optional or an index signature.
 * Same lookup as `config()`: the whole path as a declared key, then the segment before the first dot.
 */
export type ConfigValue<P extends string, T = AppConfigs> = unknown extends T
  ? unknown
  : T extends null | undefined
    ? undefined
    : P extends LiteralKey<T>
      ? T[P]
      : P extends `${infer Head}.${infer Rest}`
        ? ConfigValue<Rest, ConfigValue<Head, T>>
        : P extends keyof T
          ? T[P] | Missing<T>
          : P extends `${infer N extends number}`
            ? N extends keyof T ? T[N] | Missing<T> : undefined
            : undefined

/** Kept on globalThis: every package dist inlines its own copy of @laratype/core (see `HTTP_APP`, remove after #188). */
const store = globalThis as { __laratype_configs?: Readonly<Record<string, unknown>> }

/** Types a config file (`app/config/<name>.ts`): literal values stay literal, so driver names are typed. */
export const defineConfig = <const T extends object>(config: T): T => config

/**
 * Called once at boot by `ConfigLoadServiceProvider` with every config file, by file name. Not for app code.
 * @internal
 */
export const setConfigs = (configs: Readonly<Record<string, unknown>>): void => {
  store.__laratype_configs = configs
}

/** Keys that never name a config value: they read the prototype machinery, not the app's config. */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/** A key that is a config value: its value, which may itself be `undefined`. */
interface ReadKey {
  readonly value: unknown
}

/**
 * The value at `key` of `target`, when it is a config value: an own data property, or a getter, own or inherited (a
 * class instance's `URL.host`), because `ConfigPath` types a class instance's members. A data property above the
 * object (a method, `URL.prototype.toString`) is never read: an unbound method is not config data. Never an
 * `Object.prototype` member (`hasOwnProperty`), nor `constructor`, `prototype` or `__proto__`.
 */
const readKey = (target: unknown, key: string): ReadKey | undefined => {
  if (typeof target !== 'object' || target === null || UNSAFE_KEYS.has(key)) return undefined
  for (let level: object | null = target; level !== null && level !== Object.prototype; level = Object.getPrototypeOf(level)) {
    const descriptor = Object.getOwnPropertyDescriptor(level, key)
    // The nearest declaration hides the rest, as in a property read
    if (descriptor === undefined) continue
    // A getter runs with `target` as its receiver: `new URL(...).host` reads the instance, not the prototype
    if (descriptor.get !== undefined) return { value: Reflect.get(target, key) }
    return level === target ? { value: descriptor.value } : undefined
  }
  return undefined
}

/**
 * Reads a config value by dot path, typed from the registered configs: `config('database.default')`.
 * A key missing at run time gives `undefined`, and so does a method or a prototype data property (`app.url.toString`),
 * or a path that is not a string. Throws before the configs are loaded.
 */
export function config<const P extends ConfigPath>(path: P): ConfigValue<P>
export function config(path: string): unknown {
  // Before any read: a path object's `toString`/`indexOf` is app code that must not run
  if (typeof path !== 'string') return undefined
  let target: unknown = store.__laratype_configs
  if (target === undefined) {
    throw new Error(`[@laratype/core] config('${path}') ran before the configs were loaded (ConfigLoadServiceProvider)`)
  }
  let rest = path
  // Same lookup as ConfigValue: the whole rest as a key first, then the segment before the first dot
  for (;;) {
    const read = readKey(target, rest)
    if (read !== undefined) return read.value
    const dot = rest.indexOf('.')
    if (dot === -1) return undefined
    const head = rest.slice(0, dot)
    const step = readKey(target, head)
    if (step === undefined) return undefined
    target = step.value
    rest = rest.slice(dot + 1)
  }
}
