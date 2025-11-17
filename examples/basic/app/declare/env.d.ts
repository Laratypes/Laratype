/// <reference types="@laratype/support/env" />

interface EnvVariables {
  AUTH_GUARD: string;
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

  // Google
  AUTH_GOOGLE_CLIENT_ID: string | null;
  AUTH_GOOGLE_CLIENT_SECRET: string | null;

  // Database
  DB_CONNECTION: string | null;
  DB_HOST: string | null;
  DB_PORT: number | null;
  DB_USERNAME: string | null;
  DB_PASSWORD: string | null;
  DB_DATABASE: string | null;
}