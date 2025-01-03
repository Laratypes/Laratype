export interface EnvVariables {
  APP_NAME: string | null;
  APP_ENV: string | null;
  APP_DEBUG: boolean | null;
  APP_URL: string | null;
  TIMEZONE: string | null;
  SCHEDULE_TIMEZONE: string | null;
  LOCALE: string | null;
  FALLBACK_LOCALE: string | null;
  APP_KEY: string | null
  LOG_CHANNEL: "stack" | "single" | "daily" | null;
  LOG_LEVEL: string | null;
}