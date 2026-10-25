import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import * as z from 'zod/v4'
import { config, Container, defineEnv } from '@laratype/core'
import { bootProviders, ConfigLoadServiceProvider, EnvLoadServiceProvider, EnvValidationError, HTTP_APP, setAppManifest } from '@laratype/support'
import type { AppManifest, ManifestEntry } from '@laratype/support'

const SECRET = 'sk_live_9f8e7d6c5b4a'
const VARS = ['K1_APP_KEY', 'K1_DB_PORT'] as const

const env = defineEnv(z.object({
  K1_APP_KEY: z.string().min(32),
  K1_DB_PORT: z.coerce.number<string>().int(),
}))

const entry = (name: string, value: unknown): ManifestEntry => ({ name, path: `app/config/${name}.ts`, load: async () => ({ default: value }) })

const manifest = (configs: ManifestEntry[]): AppManifest => ({
  configs, routes: [], commands: [], models: [], migrations: [], seeders: [], factories: [], modules: [],
})

const boot = () => bootProviders(new Container().instance(HTTP_APP, new Hono()), [EnvLoadServiceProvider, ConfigLoadServiceProvider])

describe('env validation at boot (K1 #152)', () => {
  const store = globalThis as { __laratype_manifest?: unknown; __laratype_configs?: unknown; __laratype_config?: unknown }
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(VARS.map(name => [name, process.env[name]]))
  })

  afterEach(() => {
    for (const name of VARS) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
    delete store.__laratype_manifest
    delete store.__laratype_configs
    delete store.__laratype_config
    vi.restoreAllMocks()
  })

  it('fails on an invalid env, naming every failing variable and printing no value', async () => {
    process.env.K1_APP_KEY = SECRET
    process.env.K1_DB_PORT = SECRET
    const loaded = vi.fn(async () => ({ default: { name: 'app' } }))
    setAppManifest(manifest([entry('env', env), { name: 'config', path: 'app/config/config.ts', load: loaded }]))

    const error = await boot().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EnvValidationError)
    const { message, issues } = error as EnvValidationError
    expect(issues.map(issue => issue.name)).toEqual(['K1_APP_KEY', 'K1_DB_PORT'])
    expect(message).toContain('Invalid environment (app/config/env.ts), 2 failing:')
    expect(issues.map(issue => issue.message)).toEqual(['does not match the schema', 'does not match the schema'])
    expect([message, (error as Error).stack, JSON.stringify(error)].join('\n')).not.toContain(SECRET)
    // The configs, which read the env, are never loaded
    expect(loaded).not.toHaveBeenCalled()
  })

  it('boots on a valid env, then config() reads every config file but the env file', async () => {
    process.env.K1_APP_KEY = 'k'.repeat(32)
    process.env.K1_DB_PORT = '3306'
    setAppManifest(manifest([entry('env', env), entry('config', { name: 'app' }), entry('database', { default: 'mysql' })]))

    await boot()
    expect(config('database.default')).toBe('mysql')
    expect(config('config.name')).toBe('app')
    expect(config('env')).toBeUndefined()
    // process.env keeps the strings: the schema's output is not written back
    expect(process.env.K1_DB_PORT).toBe('3306')
  })

  it('validates nothing when the app has no env file', async () => {
    setAppManifest(manifest([entry('config', { name: 'app' })]))
    await boot()
    expect(config('config.name')).toBe('app')
  })

  it('fails when the env file does not export defineEnv(schema), with the 0.5 rename hint', async () => {
    setAppManifest(manifest([entry('env', { K1_APP_KEY: 'string' }), entry('config', {})]))
    await expect(boot()).rejects.toThrow('[@laratype/support] app/config/env.ts must default-export defineEnv(schema) (a 0.5 config named env: rename the file, e.g. app/config/environment.ts)')
  })
})
