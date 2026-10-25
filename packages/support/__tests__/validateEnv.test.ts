import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import * as z from 'zod/v4'
import { defineEnv } from '@laratype/core'
import type { EnvDefinition } from '@laratype/core'
import { EnvValidationError, validateEnv } from '../src/environ/validateEnv'

const SECRET = 'sk_live_9f8e7d6c5b4a'
const INVALID_MESSAGE = 'does not match the schema'

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

const failure = async (definition: EnvDefinition, source: Record<string, string>): Promise<EnvValidationError> => {
  try {
    await validateEnv(definition, source)
  } catch (error) {
    return error as EnvValidationError
  }
  throw new Error('expected validateEnv to reject')
}

/** Everything an error may print, including the objects a logger or an HTTP handler may serialize. */
const printed = (error: Error): string =>
  [error.message, error.stack, JSON.stringify(error), JSON.stringify((error as EnvValidationError).issues), String(error.cause)].join('\n')

describe.each(vendors)('validateEnv with %s', (_, definition) => {
  it('passes a valid env', async () => {
    await expect(validateEnv(definition, valid)).resolves.toBeUndefined()
  })

  it('lists every failing variable once, with a fixed message', async () => {
    const error = await failure(definition, { APP_KEY: 'short', DB_PORT: 'abc' })
    expect(error).toBeInstanceOf(EnvValidationError)
    expect(error.issues).toEqual([
      { name: 'APP_KEY', message: INVALID_MESSAGE },
      { name: 'DB_PORT', message: INVALID_MESSAGE },
      { name: 'NODE_ENV', message: INVALID_MESSAGE },
    ])
    expect(error.message).toBe(
      '[@laratype/support] Invalid environment (app/config/env.ts), 3 failing:\n'
      + `  - APP_KEY: ${INVALID_MESSAGE}\n`
      + `  - DB_PORT: ${INVALID_MESSAGE}\n`
      + `  - NODE_ENV: ${INVALID_MESSAGE}`,
    )
  })

  it('never prints a value, even when the schema message quotes it', async () => {
    const error = await failure(definition, { APP_KEY: SECRET, DB_PORT: `x${SECRET}`, NODE_ENV: SECRET })
    expect(error.issues.map(issue => issue.name)).toEqual(['APP_KEY', 'DB_PORT', 'NODE_ENV'])
    expect(printed(error)).not.toContain(SECRET)
    expect(printed(error)).not.toContain('sk_live')
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
    const error = await failure(definition, {})
    expect(error.issues).toEqual([{ name: '(environment)', message: INVALID_MESSAGE }])
  })

  it('groups issues without a path on one environment line', async () => {
    const definition = defineEnv(z.object({}).superRefine((_, ctx) => {
      ctx.addIssue({ code: 'custom', message: 'APP_URL must be set' })
      ctx.addIssue({ code: 'custom', message: 'APP_HOST must be set' })
    }))
    const error = await failure(definition, {})
    expect(error.issues).toEqual([{ name: '(environment)', message: INVALID_MESSAGE }])
    expect(error.message).toContain('1 failing:')
  })

  it('does not print the value a valibot toLowerCase/regex pipe produced', async () => {
    const definition = defineEnv(v.object({ APP_KEY: v.pipe(v.string(), v.toLowerCase(), v.regex(/^sk_/)) }))
    const error = await failure(definition, { APP_KEY: 'LIVE_SECRET_9F8E7D' })
    expect(error.issues).toEqual([{ name: 'APP_KEY', message: INVALID_MESSAGE }])
    expect(printed(error)).not.toContain('LIVE_SECRET_9F8E7D')
    expect(printed(error)).not.toContain('live_secret_9f8e7d')
  })

  it('does not print the value a zod toLowerCase/regex pipe produced', async () => {
    const definition = defineEnv(z.object({
      APP_KEY: z.string().toLowerCase().regex(/^sk_/, { error: issue => `received ${String(issue.input)}` }),
    }))
    const error = await failure(definition, { APP_KEY: 'LIVE_SECRET_9F8E7D' })
    expect(error.issues).toEqual([{ name: 'APP_KEY', message: INVALID_MESSAGE }])
    expect(printed(error)).not.toContain('LIVE_SECRET_9F8E7D')
    expect(printed(error)).not.toContain('live_secret_9f8e7d')
  })

  it('does not print the value a decodeURIComponent transform produced', async () => {
    const decoded = `sk live/secret ${SECRET}`
    const definition = defineEnv(v.object({
      APP_KEY: v.pipe(v.string(), v.transform(decodeURIComponent), v.check(() => false, issue => `bad ${issue.input}`)),
    }))
    const error = await failure(definition, { APP_KEY: encodeURIComponent(decoded) })
    expect(error.issues).toEqual([{ name: 'APP_KEY', message: INVALID_MESSAGE }])
    // EncodeURIComponent changes this value, so the test would catch a redactor that only knows the raw input
    expect(printed(error)).not.toContain(decoded)
    expect(printed(error)).not.toContain(SECRET)
  })

  it('does not print the value a base64 transform produced', async () => {
    const definition = defineEnv(v.object({
      APP_KEY: v.pipe(v.string(), v.transform(value => Buffer.from(value, 'base64').toString()), v.check(() => false, issue => `bad ${issue.input}`)),
    }))
    const error = await failure(definition, { APP_KEY: Buffer.from(SECRET).toString('base64') })
    expect(error.issues).toEqual([{ name: 'APP_KEY', message: INVALID_MESSAGE }])
    expect(printed(error)).not.toContain(SECRET)
  })

  it('names a dotted variable by its own key and prints its short value nowhere', async () => {
    const definition = defineEnv(z.object({ 'db.password': z.string().min(32) }))
    const error = await failure(definition, { 'db.password': 'hunter2' })
    // Not "db": the whole key is the variable, so a dotted env name is neither split nor confused with a path
    expect(error.issues).toEqual([{ name: 'db.password', message: INVALID_MESSAGE }])
    expect(printed(error)).not.toContain('hunter2')
  })

  it('lists a variable that fails two checks once', async () => {
    const definition = defineEnv(z.object({
      APP_KEY: z.string().superRefine((_, ctx) => {
        ctx.addIssue({ code: 'custom', message: `bad ${SECRET}` })
        ctx.addIssue({ code: 'custom', message: `also bad ${SECRET}` })
      }),
    }))
    const error = await failure(definition, { APP_KEY: SECRET })
    expect(error.issues).toEqual([{ name: 'APP_KEY', message: INVALID_MESSAGE }])
    expect(error.message).toBe(`[@laratype/support] Invalid environment (app/config/env.ts), 1 failing:\n  - APP_KEY: ${INVALID_MESSAGE}`)
    expect(printed(error)).not.toContain(SECRET)
  })

  it('prints no schema text, even when a message quotes a value under another name or with no path', async () => {
    const definition = defineEnv(z.object({ DB_URL: z.string(), DB_HOST: z.string() }).superRefine((env, ctx) => {
      ctx.addIssue({ code: 'custom', message: `DB_URL ${env.DB_URL} must use ${env.DB_HOST}`, path: ['DB_HOST'] })
      ctx.addIssue({ code: 'custom', message: `bad ${env.DB_URL}` })
    }))
    const DB_URL = `postgres://app:${SECRET}@db.local/app`
    const error = await failure(definition, { DB_URL, DB_HOST: 'db.local' })
    expect(error.issues).toEqual([
      { name: 'DB_HOST', message: INVALID_MESSAGE },
      { name: '(environment)', message: INVALID_MESSAGE },
    ])
    expect(printed(error)).not.toContain(SECRET)
  })

  it('prints no schema text, even for a JSON-escaped value', async () => {
    const value = 'pa"ss\\word'
    const schema = { '~standard': { version: 1, vendor: 'x', validate: () => ({ issues: [{ message: `bad ${JSON.stringify(value)}`, path: ['PASS'] }] }) } } as const
    const error = await failure(defineEnv(schema), { PASS: value })
    expect(error.issues).toEqual([{ name: 'PASS', message: INVALID_MESSAGE }])
    expect(printed(error)).not.toContain(value)
    expect(printed(error)).not.toContain('pa"ss')
  })

  it('prints no schema text, even for a trimmed value', async () => {
    const definition = defineEnv(v.object({ KEY: v.pipe(v.string(), v.trim(), v.check(() => false, issue => `bad key ${String(issue.input)}`)) }))
    const error = await failure(definition, { KEY: `  ${SECRET}  ` })
    expect(error.issues).toEqual([{ name: 'KEY', message: INVALID_MESSAGE }])
    expect(printed(error)).not.toContain(SECRET)
  })

  it('prints no schema text for an issue at the root', async () => {
    const definition = defineEnv(z.object({ DB_USER: z.string(), DB_PASSWORD: z.string() })
      .refine(env => env.DB_PASSWORD !== env.DB_USER, { message: 'the password must not be the user name' })
      .superRefine((env, ctx) => ctx.addIssue({ code: 'custom', message: `password ${env.DB_PASSWORD} is weak` })))
    const error = await failure(definition, { DB_USER: 'app', DB_PASSWORD: 'hunter2' })
    expect(error.issues).toEqual([{ name: '(environment)', message: INVALID_MESSAGE }])
    expect(printed(error)).not.toContain('hunter2')
  })

  it('withholds an error the schema throws, which may quote a value', async () => {
    const definition = defineEnv(z.object({ DB_URL: z.string().transform(url => JSON.parse(url) as unknown) }))
    const error = await validateEnv(definition, { DB_URL: `{${SECRET}` }).catch((e: unknown) => e) as Error
    expect(error.message).toBe('[@laratype/support] the schema of app/config/env.ts threw while validating the environment; the error is withheld since it may hold a value')
    expect(printed(error)).not.toContain(SECRET)
  })

  it('withholds the name of an error the schema throws, which may quote a value', async () => {
    class Leaky extends Error {
      override name = `Bad ${SECRET}`
    }
    const schema = { '~standard': { version: 1, vendor: 'x', validate: () => { throw new Leaky('x') } } } as const
    const error = await validateEnv(defineEnv(schema), { KEY: SECRET }).catch((e: unknown) => e) as Error
    expect(printed(error)).not.toContain(SECRET)
  })

  it('never prints a path segment the schema keyed by a value', async () => {
    const issue = (key: string) => ({ message: 'bad', path: [key] })
    const schema = { '~standard': { version: 1, vendor: 'x', validate: () => ({ issues: [issue(SECRET), issue('SK_LIVE'), issue('MISSING_KEY')] }) } } as const
    const error = await failure(defineEnv(schema), { KEY: SECRET, UPPER: 'SK_LIVE' })
    expect(error.issues).toEqual([
      { name: '(environment)', message: INVALID_MESSAGE },
      { name: 'MISSING_KEY', message: INVALID_MESSAGE },
    ])
    expect(printed(error)).not.toContain(SECRET)
    expect(printed(error)).not.toContain('SK_LIVE')
  })

  it('names a missing variable', async () => {
    const definition = defineEnv(z.object({ APP_KEY: z.string() }))
    const error = await failure(definition, {})
    expect(error.issues).toEqual([{ name: 'APP_KEY', message: INVALID_MESSAGE }])
  })

  it('awaits an async schema', async () => {
    const definition = defineEnv(z.object({ A: z.string().refine(async a => a === 'ok', 'not ok') }))
    await expect(validateEnv(definition, { A: 'ok' })).resolves.toBeUndefined()
    await expect(validateEnv(definition, { A: 'nope' })).rejects.toThrow(`  - A: ${INVALID_MESSAGE}`)
  })

  it('rejects an env file without defineEnv with a TypeError carrying the 0.5 rename hint', async () => {
    const message = '[@laratype/support] app/config/env.ts must default-export defineEnv(schema) (a 0.5 config named env: rename the file, e.g. app/config/environment.ts)'
    const error = await validateEnv({} as EnvDefinition, {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).message).toBe(message)
    await expect(validateEnv(undefined as never, {})).rejects.toThrow(TypeError)
  })
})
