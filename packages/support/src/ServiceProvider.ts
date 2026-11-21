import { Hono } from "hono";
import { Facade, token } from "@laratype/core";
import type { Container } from "@laratype/core";
import ModelBindingRegistry from "./registries/ModelBindingRegistry";
import RouteRegistry from "./registries/RouteRegistry";

export enum ServiceProviderType {
  CORE_PROVIDER = "core_provider",
  APP_PROVIDER = "app_provider",
  ROUTE_PROVIDER = "route_provider",
};

/** The Hono instance the kernel serves, bound in the container before any provider runs. */
export const HTTP_APP = token<Hono>("http.app");

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
    // The 0.5 route model bindings (D7 #114) every app container has; RequestKernel.register() clears its route bindings
    if(!app.has(ModelBindingRegistry)) {
      app.singleton(ModelBindingRegistry);
    }
  }
}

export abstract class RouteAppServiceProvider extends AppServiceProvider {

  static type = ServiceProviderType.ROUTE_PROVIDER;

  public abstract routes(): Array<Record<string, any>>;

  public boot(): void {
    const routes = this.routes();

    this.app.instance(RouteRegistry, new RouteRegistry(routes));
  }
}

/**
 * Boots every provider against `app` (construct, `register()` on all, `boot()` on all) and returns the `down()` cleanups
 * in reverse boot order; when no facade application is set, `app` becomes it for the process first (an existing one is
 * kept), so a provider's `Route.model()` / `Route.bind()` writes the registry the request path reads. A failure runs
 * `down()` on every provider whose `boot()` started (reverse order; a failing `down()` is logged; a failure before any
 * boot runs none), unsets the facade application when this boot set it, then rethrows.
 */
export async function bootProviders(app: Container, Providers: Array<typeof ServiceProvider>): Promise<Array<() => Promise<void>>> {
  const ownsFacadeApplication = !Facade.hasFacadeApplication();
  // Kept after a successful boot: the app's facades resolve from it for its whole life, and Serve.down() unsets its own
  if(ownsFacadeApplication) Facade.setFacadeApplication(app);
  const started: ServiceProvider[] = [];
  let providers: ServiceProvider[] = [];
  try {
    providers = Providers.map(Provider => new Provider(app));
    for (const provider of providers) {
      await provider.register();
    }
    for (const provider of providers) {
      started.push(provider);
      await provider.boot();
    }
  } catch (error) {
    for (const provider of [...started].reverse()) {
      // A down() may throw synchronously or return no promise
      try {
        await provider.down();
      } catch (rollbackError) {
        console.error(`[@laratype/support] bootProviders: ${provider.constructor.name}.down() failed while rolling back a failed boot`, rollbackError);
      }
    }
    // A bare boot's failed container must not stay the facade application: the next boot would keep it and write there
    if(ownsFacadeApplication && Facade.getFacadeApplication() === app) Facade.setFacadeApplication(undefined);
    throw error;
  }
  return providers.map(provider => provider.down.bind(provider)).reverse();
}
