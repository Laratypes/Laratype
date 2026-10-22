// app/config/database.ts, app/config/env.ts and the app's registration, in one file (K1 #152).
import * as z from 'zod/v4'
import { config, defineConfig, defineEnv } from '@laratype/core'

// app/config/database.ts
const database = defineConfig({
  default: 'mysql',
  connections: {
    mysql: { host: 'localhost', port: 3306 },
  },
})

// app/config/env.ts: validated at boot, before any config file loads
export const env = defineEnv(z.object({
  APP_KEY: z.string().min(32),
  DB_PORT: z.coerce.number<string>().int(),
}))

// Anywhere in the app, e.g. app/config/register.d.ts
declare module '@laratype/core' {
  interface Register {
    config: { database: typeof database }
  }
}

export const driver: 'mysql' = config('database.default')
export const port: 3306 = config('database.connections.mysql.port')
