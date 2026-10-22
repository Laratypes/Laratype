import { afterEach, describe, expect, it } from 'vitest'
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

  it('reads a key that contains a dot', () => {
    setConfigs({ mail: { 'smtp.host': 'mail.local', smtp: { port: 25 } } })
    expect(config('mail.smtp.host')).toBe('mail.local')
    expect(config('mail.smtp.port')).toBe(25)
  })

  it('defineConfig returns its argument', () => {
    const value = { default: 'mysql' }
    expect(defineConfig(value)).toBe(value)
  })
})
