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
} satisfies ConfigContract.AppConfig