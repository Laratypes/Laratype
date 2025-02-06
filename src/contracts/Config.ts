
export namespace Config {
  export interface AppConfig {
    readonly name: string
    readonly env: string
    readonly debug: boolean
    readonly url: string
    readonly timezone: string
    readonly schedule_timezone: string
    readonly locale: string
    readonly fallback_locale: string
    readonly key: string | null
    readonly cipher: string
    readonly logging: Logging.Config
  }

  export namespace Logging {
    export type CHANNEL = "stack" | "single" | "daily"
    export interface Config {
      default: CHANNEL,
      channels: {
        stack: {
          readonly driver: "stack",
          readonly channel: string[],
        },
        single: {
          readonly driver: "single",
          readonly level: string,
        },
        daily: {
          readonly driver: 'daily',
          readonly level: string,
          readonly days: number,
        }
      }
    }
  }
}