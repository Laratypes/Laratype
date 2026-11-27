import { afterEach, describe, expect, it, vi } from 'vitest'
import { config, defineConfig, setConfigs } from '@laratype/core'

const store = globalThis as { __laratype_configs?: unknown }

describe('config() (K1 #152)', () => {
  afterEach(() => {
    delete store.__laratype_configs
  })

  it('throws before the configs are loaded', () => {
    expect(() => config('database.default')).toThrow("[@laratype/core] config('database.default') ran before the configs were loaded (ConfigLoadServiceProvider)")
  })

  it('reads a value by dot path, the first segment being the file name', () => {
    setConfigs({ database: { default: 'mysql', connections: { mysql: { port: 3306 } } }, app: { name: 'x' } })
    expect(config('database.default')).toBe('mysql')
    expect(config('database.connections.mysql.port')).toBe(3306)
    expect(config('app')).toEqual({ name: 'x' })
  })

  it('gives undefined for a missing key, at any depth', () => {
    setConfigs({ database: { default: 'mysql', options: null } })
    expect(config('cache')).toBeUndefined()
    expect(config('database.missing.deep')).toBeUndefined()
    expect(config('database.default.length')).toBeUndefined()
    expect(config('database.options.x')).toBeUndefined()
  })

  it('reads own keys only, never the prototype chain', () => {
    setConfigs({ app: { name: 'x' } })
    expect(config('constructor')).toBeUndefined()
    expect(config('app.toString')).toBeUndefined()
    expect(config('app.__proto__')).toBeUndefined()
  })

  it('reads a getter of a class instance, but never a prototype method or Object.prototype member', () => {
    class Client {
      readonly host = 'redis.local'
      get port() {
        return 6379
      }
    }
    const transport = () => 'log'
    setConfigs({ app: { url: new URL('https://app.test/x'), client: new Client(), plain: Object.create(null), transport } })
    // ConfigPath types a class instance's members (`config.test-d.ts` asserts `config('mail.url.host')`): read them
    expect(config('app.url.host')).toBe('app.test')
    expect(config('app.client.host')).toBe('redis.local')
    expect(config('app.client.port')).toBe(6379)
    // A method is a data property on the prototype: returning it would return an unbound method (K4 #314)
    expect(config('app.url.toString')).toBeUndefined()
    expect(config('app.url.toJSON')).toBeUndefined()
    expect(config('app.client.constructor')).toBeUndefined()
    expect(config('app.client.toString')).toBeUndefined()
    expect(config('app.client.hasOwnProperty')).toBeUndefined()
    expect(config('app.plain.toString')).toBeUndefined()
    // An own function is a leaf value, as ConfigPath types it: config('mail.transport') is `() => void`
    expect(config('app.transport')).toBe(transport)
  })

  it('does not read a data property declared on the prototype', () => {
    class Driver {
      readonly name = 'mysql'
    }
    Object.defineProperty(Driver.prototype, 'version', { value: '8.0', configurable: true })
    setConfigs({ app: { driver: new Driver() } })
    expect(config('app.driver.name')).toBe('mysql')
    expect(config('app.driver.version')).toBeUndefined()
  })

  it('invokes a getter only when the path reads its key', () => {
    const port = vi.fn(() => 6379)
    setConfigs({ app: { client: { host: 'redis.local', get port() { return port() } } } })
    expect(config('app.client.host')).toBe('redis.local')
    expect(port).not.toHaveBeenCalled()
    expect(config('app.client.port')).toBe(6379)
    expect(port).toHaveBeenCalledOnce()
  })

  it('propagates the error a getter throws, since a getter is app code', () => {
    setConfigs({ app: { get boom(): string { throw new Error('getter ran') } } })
    expect(() => config('app.boom')).toThrow('getter ran')
  })

  it('gives undefined for __proto__, constructor and prototype segments, even own keys', () => {
    // JSON.parse defines own keys, unlike the __proto__ setter of an object literal
    const app = JSON.parse('{"__proto__":{"polluted":true},"constructor":"fn","prototype":"proto","ok":1}') as Record<string, unknown>
    setConfigs({ app })
    expect(config('app.ok')).toBe(1)
    expect(config('app.__proto__')).toBeUndefined()
    expect(config('app.__proto__.polluted')).toBeUndefined()
    expect(config('app.constructor')).toBeUndefined()
    expect(config('app.prototype')).toBeUndefined()
    expect(config('__proto__')).toBeUndefined()
    expect(config('constructor')).toBeUndefined()
    expect(config('prototype')).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('treats a path that is not a string as a miss, without running app code on it', () => {
    const toString = vi.fn(() => { throw new Error('converted') })
    const paths = [undefined, null, 1, Number.NaN, {}, { length: 1e9 }, { toString }, Promise.resolve('app')]
    // Before the configs load too: the type check comes before the loaded check
    for (const path of paths) expect(config(path as never)).toBeUndefined()
    setConfigs({ app: {} })
    for (const path of paths) expect(config(path as never)).toBeUndefined()
    expect(toString).not.toHaveBeenCalled()
  })

  it('gives undefined for empty paths and empty segments', () => {
    setConfigs({ app: { name: 'x' } })
    for (const path of ['', '.', '..', '.app', 'app.', 'app..name', 'app.name.', 'app...name']) {
      expect(config(path)).toBeUndefined()
    }
  })

  it('gives undefined for a 100k-segment path', () => {
    setConfigs({ app: { name: 'x' } })
    expect(config(['app', ...Array.from({ length: 99_999 }, () => 'a')].join('.'))).toBeUndefined()
  })

  it('returns NaN, Infinity and an object with a huge length as they are', () => {
    const big = { length: 1e9 }
    setConfigs({ app: { nan: Number.NaN, inf: Infinity, ninf: -Infinity, big } })
    expect(config('app.nan')).toBeNaN()
    expect(config('app.inf')).toBe(Infinity)
    expect(config('app.ninf')).toBe(-Infinity)
    expect(config('app.big')).toBe(big)
    expect(config('app.big.length')).toBe(1e9)
  })

  it('reads a key with a lone surrogate and control characters', () => {
    const key = `a\uD800b\n\t`
    setConfigs({ app: { [key]: 'x' } })
    expect(config(`app.${key}`)).toBe('x')
  })

  it('reads a key that contains a dot', () => {
    setConfigs({ mail: { 'smtp.host': 'mail.local', smtp: { port: 25 } } })
    expect(config('mail.smtp.host')).toBe('mail.local')
    expect(config('mail.smtp.port')).toBe(25)
  })

  it('reads the whole rest of the path before it splits, so a dotted key can end with a reserved segment', () => {
    // Computed keys: a literal `__proto__` key would set the prototype instead of declaring one
    setConfigs({ a: { ['b.constructor']: 42, ['b.prototype']: 43, ['b.__proto__']: 44, ['constructor.b']: 45 } })
    expect(config('a.b.constructor')).toBe(42)
    expect(config('a.b.prototype')).toBe(43)
    expect(config('a.b.__proto__')).toBe(44)
    expect(config('a.constructor.b')).toBe(45)
    // A single reserved segment is still rejected: the whole rest is reserved, so no key is read
    expect(config('a.constructor')).toBeUndefined()
  })

  it('defineConfig returns its argument', () => {
    const value = { default: 'mysql' }
    expect(defineConfig(value)).toBe(value)
  })
})
