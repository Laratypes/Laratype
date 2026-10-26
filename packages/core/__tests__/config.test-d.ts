// Type tests for config() and defineEnv (K1 #152): run by `bunx vitest run --project types`.
import { describe, expectTypeOf, test } from 'vitest'
import * as v from 'valibot'
import * as z from 'zod/v4'
import { config, defineConfig, defineEnv } from '@laratype/core'
import type { ConfigPath, ConfigValue, EnvDefinition } from '@laratype/core'
import type { InferOut } from '@laratype/contract'

const database = defineConfig({
  default: 'mysql',
  connections: {
    mysql: { host: 'localhost', port: 3306 },
  },
})

interface Mail {
  readonly mailer: 'smtp' | 'log'
  readonly smtp?: { readonly host: string }
  readonly 'reply.to': { readonly address: string }
  readonly url: URL
  readonly hosts: string[]
  readonly from: Record<string, string>
  readonly mailers: Record<string, { readonly host: string }>
  readonly transport: () => void
  readonly model: typeof Model
}

class Model {
  static table = 'users'
  email = ''
}

// The app's registration: what `declare module` in app code looks like (Q16). It applies to the whole `types`
// program, so this is the only type test that registers configs.
declare module '@laratype/core' {
  interface Register {
    config: { database: typeof database; mail: Mail }
  }
}

describe('config() (K1 #152)', () => {
  test('infers the value from the dot path', () => {
    expectTypeOf(config('database.default')).toEqualTypeOf<'mysql'>()
    expectTypeOf(config('database.connections.mysql.port')).toEqualTypeOf<3306>()
    expectTypeOf(config('database.connections')).toEqualTypeOf<{ readonly mysql: { readonly host: 'localhost'; readonly port: 3306 } }>()
    expectTypeOf(config('mail.mailer')).toEqualTypeOf<'smtp' | 'log'>()
    expectTypeOf(config('mail.url.host')).toEqualTypeOf<string>()
  })

  test('a key read through an index signature may be missing', () => {
    expectTypeOf(config('mail.from.sender')).toEqualTypeOf<string | undefined>()
    expectTypeOf(config('mail.mailers.smtp')).toEqualTypeOf<{ readonly host: string } | undefined>()
    expectTypeOf(config('mail.mailers.smtp.host')).toEqualTypeOf<string | undefined>()
  })

  test('a key that contains a dot ends the path', () => {
    expectTypeOf(config('mail.reply.to')).toEqualTypeOf<{ readonly address: string }>()
    // @ts-expect-error no path through a key that contains a dot
    config('mail.reply.to.address')
  })

  test('an optional key on the path adds undefined', () => {
    expectTypeOf(config('mail.smtp')).toEqualTypeOf<{ readonly host: string } | undefined>()
    expectTypeOf(config('mail.smtp.host')).toEqualTypeOf<string | undefined>()
  })

  test('paths stop at arrays and functions', () => {
    expectTypeOf(config('mail.hosts')).toEqualTypeOf<string[]>()
    expectTypeOf(config('mail.transport')).toEqualTypeOf<() => void>()
    // @ts-expect-error no path into an array
    config('mail.hosts.0')
    // @ts-expect-error no path into a function
    config('mail.transport.length')
    expectTypeOf(config('mail.model')).toEqualTypeOf<typeof Model>()
    // @ts-expect-error no path into a class
    config('mail.model.table')
  })

  test('unknown paths are errors', () => {
    // @ts-expect-error unknown file
    config('cache.default')
    // @ts-expect-error unknown key
    config('database.connections.pgsql')
    // @ts-expect-error a path, not keys
    config(['database', 'default'])
  })

  test('without a registration, any path gives unknown', () => {
    expectTypeOf<ConfigPath<Record<string, unknown>>>().toEqualTypeOf<string>()
    expectTypeOf<ConfigValue<'a.b', Record<string, unknown>>>().toEqualTypeOf<unknown>()
  })

  test('defineConfig keeps literal values', () => {
    expectTypeOf(defineConfig({ driver: 'redis', ttl: 60 })).toEqualTypeOf<{ readonly driver: 'redis'; readonly ttl: 60 }>()
    // @ts-expect-error a config is an object
    defineConfig('redis')
  })
})

describe('defineEnv (K1 #152)', () => {
  test('takes any Standard Schema and keeps it', () => {
    const zodEnv = defineEnv(z.object({ PORT: z.coerce.number<string>() }))
    expectTypeOf(zodEnv.schema).toEqualTypeOf<z.ZodObject<{ PORT: z.ZodCoercedNumber<string> }>>()
    expectTypeOf<InferOut<typeof zodEnv.schema>>().toEqualTypeOf<{ PORT: number }>()

    const valibotEnv = defineEnv(v.object({ APP_KEY: v.string() }))
    expectTypeOf<InferOut<typeof valibotEnv.schema>>().toEqualTypeOf<{ APP_KEY: string }>()
    expectTypeOf(valibotEnv).toExtend<EnvDefinition>()
  })

  test('rejects what is not a Standard Schema', () => {
    // @ts-expect-error not a Standard Schema
    defineEnv({ PORT: 'number' })
    // @ts-expect-error not a Standard Schema
    defineEnv((value: unknown) => value)
  })
})
