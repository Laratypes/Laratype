import { Hono } from "hono";

export class ServiceProvider {

  public register(): void | Promise<void> {
    
  }

  public boot(): void | Promise<void> {
    
  }
}

export class AppServiceProvider extends ServiceProvider {
  public bindings = [];
  public apps: Hono;

  constructor(apps: Hono) {
    super();
    this.apps = apps;
  }
}