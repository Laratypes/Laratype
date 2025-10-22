import { Hono } from "hono";
import { type ViteDevServer } from "vite"

export enum ServiceProviderType {
  CORE_PROVIDER = "core_provider",
  APP_PROVIDER = "app_provider",
  ROUTE_PROVIDER = "route_provider",
};

export class ServiceProvider {

  static type = ServiceProviderType.CORE_PROVIDER;
  protected transpile: ViteDevServer;

  constructor(vite: ViteDevServer) {
    this.transpile = vite;
  }

  public register(): void | Promise<void> {
    
  }

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

  constructor(vite: ViteDevServer, apps: Hono) {
    super(vite);
    this.apps = apps;
  }
}

export abstract class RouteAppServiceProvider extends AppServiceProvider {

  static type = ServiceProviderType.ROUTE_PROVIDER;
  public bindings = [];
  public apps: Hono;

  constructor(vite: ViteDevServer, apps: Hono) {
    super(vite, apps);
    this.apps = apps;
  }
  
  public abstract routes(): Array<Record<string, any>>;

  public boot(): void {
    const routes = this.routes();

    globalThis.__laratype_routes = routes;
  }
}