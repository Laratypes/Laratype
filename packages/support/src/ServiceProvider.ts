import { Hono } from "hono";
import { token } from "@laratype/core";
import type { Container, InjectionToken } from "@laratype/core";

export enum ServiceProviderType {
  CORE_PROVIDER = "core_provider",
  APP_PROVIDER = "app_provider",
  ROUTE_PROVIDER = "route_provider",
};

/**
 * The Hono instance the kernel serves, bound in the container before any provider runs.
 * TEMPORARY: kept on globalThis because every package dist inlines its own copy of
 * @laratype/support (the @laratype externals regex in bun.build.js has no effect), so a
 * module-level token would be a different key per bundle. Make it a plain module-level
 * `token()` once the @laratype packages are real externals (remove after #188 (B13)).
 */
const tokens = globalThis as { __laratype_http_app_token?: InjectionToken<Hono> };
export const HTTP_APP = tokens.__laratype_http_app_token ??= token<Hono>("http.app");

export class ServiceProvider {

  static type = ServiceProviderType.CORE_PROVIDER;

  /** The application container. */
  public readonly app: Container;

  constructor(app: Container) {
    this.app = app;
  }

  /** Bind things into the container. Runs for every provider before any `boot()`. */
  public register(): void | Promise<void> {

  }

  /** Runs after every provider has registered, so all bindings are available. */
  public boot(): void | Promise<void> {

  }

  public async down(): Promise<void> {
    // Cleanup logic here
  }
}

export class AppServiceProvider extends ServiceProvider {

  static type = ServiceProviderType.APP_PROVIDER;
  public bindings = [];
  public apps: Hono;

  constructor(app: Container) {
    super(app);
    this.apps = app.make(HTTP_APP);
  }
}

export abstract class RouteAppServiceProvider extends AppServiceProvider {

  static type = ServiceProviderType.ROUTE_PROVIDER;

  public abstract routes(): Array<Record<string, any>>;

  public boot(): void {
    const routes = this.routes();

    globalThis.__laratype_routes = routes;
  }
}

/**
 * Two-phase provider lifecycle: instantiate every provider with the container,
 * call `register()` on all of them, then `boot()` on all of them, in order.
 * Returns the `down()` cleanups in reverse boot order.
 */
export async function bootProviders(app: Container, Providers: Array<typeof ServiceProvider>): Promise<Array<() => Promise<void>>> {
  const providers = Providers.map(Provider => new Provider(app));
  for (const provider of providers) {
    await provider.register();
  }
  for (const provider of providers) {
    await provider.boot();
  }
  return providers.map(provider => provider.down.bind(provider)).reverse();
}
