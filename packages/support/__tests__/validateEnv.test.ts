import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import * as z from 'zod/v4'
import { defineEnv } from '@laratype/core'
import type { EnvDefinition } from '@laratype/core'
import { EnvValidationError, validateEnv } from '../src/environ/validateEnv'

const SECRET = 'sk_live_9f8e7d6c5b4a'

const vendors: [string, EnvDefinition][] = [
  [
    'zod 4',
    defineEnv(z.object({
      APP_KEY: z.string().min(32),
      DB_PORT: z.coerce.number<string>().int(),
      NODE_ENV: z.enum(['development', 'production']),
    })),
  ],
  [
    'valibot',
    defineEnv(v.object({
      APP_KEY: v.pipe(v.string(), v.minLength(32)),
      DB_PORT: v.pipe(v.string(), v.digits()),
      NODE_ENV: v.picklist(['development', 'production']),
    })),
  ],
]

const valid = { APP_KEY: 'k'.repeat(32), DB_PORT: '3306', NODE_ENV: 'production', OTHER: 'x' }

describe.each(vendors)('validateEnv with %s', (_, definition) => {
  it('passes a valid env', async () => {
    await expect(validateEnv(definition, valid)).resolves.toBeUndefined()
  })

  it('lists every failing variable with its message', async () => {
    const error = await validateEnv(definition, { APP_KEY: 'short', DB_PORT: 'abc' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EnvValidationError)
    const { issues, message } = error as EnvValidationError
    expect(issues.map(issue => issue.name)).toEqual(['APP_KEY', 'DB_PORT', 'NODE_ENV'])
    expect(message).toMatch(/^\[@laratype\/support\] Invalid environment \(app\/config\/env\.ts\), 3 failing:\n {2}- APP_KEY: .+\n {2}- DB_PORT: .+\n {2}- NODE_ENV: .+$/)
  })

  it('never prints a value, even when the schema message quotes it', async () => {
    const error = await validateEnv(definition, { APP_KEY: SECRET, DB_PORT: `x${SECRET}`, NODE_ENV: SECRET }).catch((e: unknown) => e) as EnvValidationError
    expect(error.issues.map(issue => issue.name)).toEqual(['APP_KEY', 'DB_PORT', 'NODE_ENV'])
    const printed = [error.message, error.stack, JSON.stringify(error), JSON.stringify(error.issues), String(error.cause)].join('\n')
    expect(printed).not.toContain(SECRET)
    expect(printed).not.toContain('sk_live')
  })

  it('does not change the source', async () => {
    const source = { ...valid }
    await validateEnv(definition, source)
    expect(source).toEqual(valid)
  })
})

describe('validateEnv', () => {
  it('names an issue without a path as the environment', async () => {
    const definition = defineEnv(z.object({}).refine(() => false, 'APP_URL or APP_HOST must be set'))
    const error = await validateEnv(definition, {}).catch((e: unknown) => e) as EnvValidationError
    expect(error.issues).toEqual([{ name: '(environment)', message: 'APP_URL or APP_HOST must be set' }])
  })

  it('redacts the JSON-escaped form of a value', async () => {
    const value = 'pa"ss\\word'
    const schema = { '~standard': { version: 1, vendor: 'x', validate: () => ({ issues: [{ message: `bad ${JSON.stringify(value)}`, path: ['PASS'] }] }) } } as const
    const error = await validateEnv(defineEnv(schema), { PASS: value }).catch((e: unknown) => e) as EnvValidationError
    expect(error.issues).toEqual([{ name: 'PASS', message: 'bad "***"' }])
  })

  it('awaits an async schema', async () => {
    const definition = defineEnv(z.object({ A: z.string().refine(async a => a === 'ok', 'not ok') }))
    await expect(validateEnv(definition, { A: 'ok' })).resolves.toBeUndefined()
    await expect(validateEnv(definition, { A: 'nope' })).rejects.toThrow('  - A: not ok')
  })

  it('rejects an env file without defineEnv', async () => {
    await expect(validateEnv({} as EnvDefinition, {})).rejects.toThrow(new TypeError('[@laratype/support] app/config/env.ts must default-export defineEnv(schema)'))
    await expect(validateEnv(undefined as never, {})).rejects.toThrow(TypeError)
  })
})
