import { LaratypeConfig as ConfigContract, Env } from "@laratype/support";

export default {
  locale: "vi",
  fallback_locale: "en",
  key: Env.get("APP_KEY", ""),
  name: "Laratype Framework",
  env: "local",
  schedule_timezone: "UTC",
  timezone: "UTC",
  url: "http://localhost",
  cipher: "aes-256-cbc",
  debug: false,
  logging: {
    default: "single",
    channels: {
      single: {
        driver: "single",
        level: "debug"
      },
      stack: {
        driver: "stack",
        channel: ["single"],
      },
      daily: {
        days: 7,
        driver: "daily",
        level: "debug",
      }
    },
  },
  database: {
    default: "mysql",
    connections: {
      mysql: {
        type: "mysql",
        host: Env.get("DB_HOST", "localhost"),
        port: parseInt(Env.get("DB_PORT", "3306")),
        username: Env.get("DB_USERNAME", "root"),
        password: Env.get("DB_PASSWORD", ""),
        database: Env.get("DB_DATABASE", "test"),
      }
    }
  }
} satisfies ConfigContract.AppConfig