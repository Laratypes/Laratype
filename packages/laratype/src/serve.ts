import { Hono } from "hono"
import { Container } from "@laratype/core";
import { bootProviders, HTTP_APP } from "@laratype/support";
import { register } from "./bootstrap";

export default class Serve {
  
  private static instance: Hono|null = null

  private static container: Container|null = null

  protected static port: number = 3000;

  protected static host: string = 'localhost';

  public static getInstance() {
    if(!this.instance) this.instance = new Hono();
    return this.instance
  }

  /** The application container, with the Hono instance bound. */
  public static getContainer() {
    if(!this.container) {
      this.container = new Container();
      this.container.instance(HTTP_APP, this.getInstance());
    }
    return this.container
  }

  public static async bootProvider() {
    const serviceProviderBootstrapped = await register()
    return bootProviders(this.getContainer(), serviceProviderBootstrapped);
  }

  public static down() {
    this.instance = null;
    this.container = null;
  }
}
