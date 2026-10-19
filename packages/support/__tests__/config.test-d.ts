// Type tests: run by `bunx vitest run --project types`.
import { describe, expectTypeOf, test } from 'vitest'
import type { LaratypeConfig } from '../src/contracts/Config'

const base = {
  name: 'app', env: 'local', debug: false, url: 'http://localhost', timezone: 'UTC', schedule_timezone: 'UTC',
  locale: 'en', fallback_locale: 'en', key: null, cipher: 'aes-256-cbc',
}

describe('AppConfig.api (H1 #104)', () => {
  test('the contract tree root and base are optional', () => {
    expectTypeOf(base).toExtend<LaratypeConfig.AppConfig>()
    expectTypeOf({ ...base, api: {} }).toExtend<LaratypeConfig.AppConfig>()
    const config = { ...base, api: { root: 'app/contracts', base: '/v2' } } satisfies LaratypeConfig.AppConfig
    expectTypeOf(config.api.root).toEqualTypeOf<string>()
    expectTypeOf<NonNullable<LaratypeConfig.AppConfig['api']>>().toEqualTypeOf<{ readonly root?: string; readonly base?: string }>()
  })

  test('negatives', () => {
    // @ts-expect-error api.root is a string
    const badRoot = { ...base, api: { root: 1 } } satisfies LaratypeConfig.AppConfig
    // @ts-expect-error unknown key under api
    const unknown = { ...base, api: { out: '.laratype' } } satisfies LaratypeConfig.AppConfig
    void badRoot, unknown
  })
})
