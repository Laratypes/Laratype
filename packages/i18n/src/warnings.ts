/**
 * The one-time dev warning for a caller that needed a request scope but runs on a route served without `RequestKernel`:
 * there is no request scope to hold the locale, so it leaves the shared default alone instead of changing it for the
 * next requests. Once per caller and per process, and silent in production.
 */
export const warnNoRequestContainer = (caller: string): void => {
  const store = globalThis as {
    __PROD__?: boolean;
    process?: { env?: Record<string, string | undefined> };
    [key: symbol]: unknown;
  };
  const production = store.__PROD__ ?? store.process?.env?.NODE_ENV === "production";
  const key = Symbol.for(`laratype.i18n.noRequestContainer.${caller}`);
  if (production || store[key] === true) return;
  store[key] = true;
  console.warn(
    `[@laratype/i18n] ${caller} has no request container (the route is not served through RequestKernel), so it left the app default locale unchanged: serve the route through RequestKernel to choose a locale per request.`,
  );
};
