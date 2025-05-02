import { LaratypeConfig as ConfigContract } from "@laratype/support";

export default {
  locale: "vi",
  fallback_locale: "en",
  key: "base64:K1x5a3h0b2l6cG9vZ3V0aW5n",
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