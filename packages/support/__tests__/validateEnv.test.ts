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

  it('redacts a long value that a message quotes under another name, or with no path', async () => {
    const definition = defineEnv(z.object({ DB_URL: z.string(), DB_HOST: z.string() }).superRefine((env, ctx) => {
      ctx.addIssue({ code: 'custom', message: `DB_URL ${env.DB_URL} must use ${env.DB_HOST}`, path: ['DB_HOST'] })
      ctx.addIssue({ code: 'custom', message: `bad ${env.DB_URL}` })
    }))
    const DB_URL = `postgres://app:${SECRET}@db.local/app`
    const error = await validateEnv(definition, { DB_URL, DB_HOST: 'db.local' }).catch((e: unknown) => e) as EnvValidationError
    expect(error.issues).toEqual([
      { name: 'DB_HOST', message: 'DB_URL *** must use ***' },
      { name: '(environment)', message: 'bad ***' },
    ])
  })

  it('cuts a short value only where it stands alone, so the message stays readable', async () => {
    const definition = defineEnv(v.object({ PORT: v.pipe(v.string(), v.transform(Number), v.minValue(1024)), MODE: v.picklist(['dev', 'prod']) }))
    const error = await validateEnv(definition, { PORT: '0', MODE: 'e' }).catch((e: unknown) => e) as EnvValidationError
    expect(error.issues).toEqual([
      { name: 'PORT', message: 'Invalid value: Expected >=1024 but received ***' },
      { name: 'MODE', message: 'Invalid type: Expected ("dev" | "prod") but received "***"' },
    ])
  })

  it('keeps the schema text that only contains a value', async () => {
    const definition = defineEnv(z.object({ NODE_ENV: z.enum(['development', 'production']) }))
    const error = await validateEnv(definition, { NODE_ENV: 'prod' }).catch((e: unknown) => e) as EnvValidationError
    expect(error.issues).toEqual([{ name: 'NODE_ENV', message: 'Invalid option: expected one of "development"|"production"' }])
  })

  it('redacts a trimmed value', async () => {
    const definition = defineEnv(v.object({ KEY: v.pipe(v.string(), v.trim(), v.check(() => false, issue => `bad key ${String(issue.input)}`)) }))
    const error = await validateEnv(definition, { KEY: `  ${SECRET}  ` }).catch((e: unknown) => e) as EnvValidationError
    expect(error.message).not.toContain(SECRET)
    expect(error.issues).toEqual([{ name: 'KEY', message: 'bad key ***' }])
  })

  it('redacts a short value quoted at the root', async () => {
    const definition = defineEnv(z.object({ DB_USER: z.string(), DB_PASSWORD: z.string() })
      .refine(env => env.DB_PASSWORD !== env.DB_USER, { message: 'the password must not be the user name' })
      .superRefine((env, ctx) => ctx.addIssue({ code: 'custom', message: `password ${env.DB_PASSWORD} is weak` })))
    const error = await validateEnv(definition, { DB_USER: 'app', DB_PASSWORD: 'hunter2' }).catch((e: unknown) => e) as EnvValidationError
    expect(error.message).not.toContain('hunter2')
    expect(error.issues).toEqual([{ name: '(environment)', message: 'password *** is weak' }])
  })

  it('withholds an error the schema throws, which may quote a value', async () => {
    const definition = defineEnv(z.object({ DB_URL: z.string().transform(url => JSON.parse(url) as unknown) }))
    const error = await validateEnv(definition, { DB_URL: `{${SECRET}` }).catch((e: unknown) => e) as Error
    expect(error.message).toBe('[@laratype/support] the schema of app/config/env.ts threw (SyntaxError) while validating the environment; its message is withheld since it may hold a value')
    expect([error.message, error.stack, String(error.cause)].join('\n')).not.toContain(SECRET)
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
