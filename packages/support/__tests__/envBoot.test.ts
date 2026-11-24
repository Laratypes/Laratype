import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import * as z from 'zod/v4'
import { config, Container, defineEnv, Facade } from '@laratype/core'
import { bootProviders, ConfigLoadServiceProvider, EnvLoadServiceProvider, EnvValidationError, HTTP_APP, setAppManifest } from '@laratype/support'
import { entryWithValue as entry, manifestWith as manifest } from './fixtures/manifest'

const SECRET = 'sk_live_9f8e7d6c5b4a'
const VARS = ['K1_APP_KEY', 'K1_DB_PORT', 'K4_ENV_NO_MANIFEST'] as const

const env = defineEnv(z.object({
  K1_APP_KEY: z.string().min(32),
  K1_DB_PORT: z.coerce.number<string>().int(),
}))

const boot = () => bootProviders(new Container().instance(HTTP_APP, new Hono()), [EnvLoadServiceProvider, ConfigLoadServiceProvider])
const bootEnvOnly = () => bootProviders(new Container().instance(HTTP_APP, new Hono()), [EnvLoadServiceProvider])

describe('env validation at boot (K1 #152)', () => {
  const store = globalThis as {
    __laratype_manifest?: unknown
    __laratype_configs?: unknown
    __laratype_config?: unknown
    __laratype_env_file?: unknown
  }
  let saved: Record<string, string | undefined>
  let savedEnvFile: unknown
  const dirs: string[] = []
  const root = process.cwd()

  /** A project directory with a `.env`, made the process cwd (`loadEnv()` without a projectDir reads the cwd). */
  const projectWithEnv = (contents: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'laratype-env-boot-'))
    dirs.push(dir)
    writeFileSync(join(dir, '.env'), contents)
    process.chdir(dir)
    return dir
  }

  beforeEach(() => {
    saved = Object.fromEntries(VARS.map(name => [name, process.env[name]]))
    savedEnvFile = store.__laratype_env_file
  })

  afterEach(() => {
    for (const name of VARS) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
    if (savedEnvFile === undefined) delete store.__laratype_env_file
    else store.__laratype_env_file = savedEnvFile
    process.chdir(root)
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
    delete store.__laratype_manifest
    delete store.__laratype_configs
    delete store.__laratype_config
    // bootProviders() makes its container the facade application when none is set: don't leak it into the next test
    Facade.setFacadeApplication(undefined)
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

  it('loads .env without the app manifest', async () => {
    const dir = projectWithEnv('K4_ENV_NO_MANIFEST=loaded\n')
    // An inherited value wins over the file (loadEnv keeps values already set), so clear it before the boot
    delete process.env.K4_ENV_NO_MANIFEST
    // Only the env provider: no manifest means ConfigLoadServiceProvider has nothing to load
    await bootEnvOnly()
    expect(process.env.K4_ENV_NO_MANIFEST).toBe('loaded')
    expect(globalThis.__laratype_env_file).toBe(join(dir, '.env'))
  })

  it('still loads .env and validates when the app has a manifest', async () => {
    const key = 'k'.repeat(32)
    const dir = projectWithEnv(`K1_APP_KEY=${key}\nK1_DB_PORT=3306\n`)
    delete process.env.K1_APP_KEY
    delete process.env.K1_DB_PORT
    setAppManifest(manifest([entry('env', env), entry('config', {})]))
    await bootEnvOnly()
    expect(process.env.K1_APP_KEY).toBe(key)
    expect(process.env.K1_DB_PORT).toBe('3306')
    expect(globalThis.__laratype_env_file).toBe(join(dir, '.env'))
  })

  it('still fails on a manifest scan error', async () => {
    setAppManifest({ ...manifest([]), error: 'config name app is used twice' })
    await expect(bootEnvOnly()).rejects.toThrow('config name app is used twice')
  })

  it('fails when the env file does not export defineEnv(schema), with the 0.5 rename hint', async () => {
    setAppManifest(manifest([entry('env', { K1_APP_KEY: 'string' }), entry('config', {})]))
    const error = await boot().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).message).toBe('[@laratype/support] app/config/env.ts must default-export defineEnv(schema) (a 0.5 config named env: rename the file, e.g. app/config/environment.ts)')
  })
})
