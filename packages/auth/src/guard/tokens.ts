import { token } from "@laratype/core";
import type { LaratypeConfig as Config } from "@laratype/support";

/** The app's `app/config/auth.ts`, bound by `PassportServiceProvider.register()` (A4 #151). */
export const AUTH_CONFIG = token<Config.Auth>("auth.config");

/** One entry of `guards` in `app/config/auth.ts`. */
export type GuardConfig = Config.Auth["guards"][string];
