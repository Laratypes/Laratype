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

/** Paths stop at arrays and functions, and after 8 levels so big option types stay cheap to check. */
type Stop = readonly unknown[] | ((...args: never[]) => unknown)

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

/**
 * Own keys of a plain object; on a class instance (a `URL`, a client), its members too, as `ConfigPath` types them.
 * Never `Object.prototype` members (`__proto__`, `hasOwnProperty`) or `constructor`.
 */
const has = (target: unknown, key: string): target is Record<string, unknown> => {
  if (typeof target !== 'object' || target === null || key === 'constructor') return false
  for (let level: object | null = target; level !== null && level !== Object.prototype; level = Object.getPrototypeOf(level)) {
    if (Object.hasOwn(level, key)) return true
  }
  return false
}

/**
 * Reads a config value by dot path, typed from the registered configs: `config('database.default')`.
 * A key missing at run time gives `undefined`. Throws before the configs are loaded.
 */
export function config<const P extends ConfigPath>(path: P): ConfigValue<P>
export function config(path: string): unknown {
  let target: unknown = store.__laratype_configs
  if (target === undefined) {
    throw new Error(`[@laratype/core] config('${path}') ran before the configs were loaded (ConfigLoadServiceProvider)`)
  }
  let rest = path
  // Same lookup as ConfigValue: the whole rest as a key first, then the segment before the first dot
  for (;;) {
    if (has(target, rest)) return target[rest]
    const dot = rest.indexOf('.')
    if (dot === -1) return undefined
    const head = rest.slice(0, dot)
    if (!has(target, head)) return undefined
    target = target[head]
    rest = rest.slice(dot + 1)
  }
}
