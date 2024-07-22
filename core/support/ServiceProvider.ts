import { Hono } from "hono";

export default class ServiceProvider {

  public bindings = [];
  public apps: Hono;

  constructor(apps: Hono) {
    this.apps = apps;
  }

  public register() {
    
  }

  public boot() {
    
  }
}