import { Config } from "@laratype/support";
import { Config as ConfigContract } from "laratype";

export const start = async () => {
  const config: ConfigContract.AppConfig = {
    name: 'localhost',
    env: 'test',
    debug: true,
    url: 'http://localhost',
    timezone: 'Asia/Tokyo',
    schedule_timezone: 'UTC',
    locale: 'en',
    fallback_locale: 'en',
    key: null,
    cipher: 'AES-256-CBC',
    logging: {
      default: 'daily',
      channels: {
        stack: {
          driver: 'stack' as const,
          channel: ['single'],
        },
        single: {
          driver: 'single' as const,
          level: 'debug',
        },
        daily: {
          driver: 'daily' as const,
          level: 'debug',
          days: 14 as const,
        }
      }
    }
  }
  Config.setConfigs(config)
}