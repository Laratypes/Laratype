// Service managers over a typed config file (F1 #160, proposed): docs/v1/services.md › Driver Manager.
import { config, defineConfig, Manager } from '@laratype/core'

// app/config/cache.ts: the literal `default` and the store keys a manager types its drivers from.
const cache = defineConfig({
  default: 'redis',
  stores: {
    redis: { host: 'localhost', port: 6379 },
    array: {},
  },
})

// The app's registration (K1 #152), e.g. app/config/register.d.ts.
declare module '@laratype/core' {
  interface Register {
    config: { cache: typeof cache }
  }
}

interface Store {
  get(key: string): Promise<string | null>
}

class CacheManager extends Manager<Record<keyof typeof cache.stores, Store>, typeof cache.default> {
  protected override get defaultDriver(): typeof cache.default {
    return config('cache.default')
  }

  protected override createDriver(name: keyof typeof cache.stores): Store {
    return { get: async (key) => `[${name}] ${key}` }
  }
}

const stores = new CacheManager()

export const fromDefault: Promise<string | null> = stores.driver().get('key') // the 'redis' store
export const fromArray: Promise<string | null> = stores.driver('array').get('key')

// A custom driver: declare the name in the config first, then replace its factory.
stores.extend('array', () => ({ get: async () => null }))

// A name the manager does not declare does not compile.
// @ts-expect-error "file" is not a cache store of app/config/cache.ts
stores.driver('file')
