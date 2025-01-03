import { Hono } from "hono";

export class ServiceProvider {

  public bindings = [];
  public apps: Hono;

  constructor(apps: Hono) {
    this.apps = apps;
  }

  public register(): void | Promise<void> {
    
  }

  public boot(): void | Promise<void> {
    
  }
}