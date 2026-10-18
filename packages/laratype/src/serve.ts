import { Hono } from "hono"
import { Container, depsRegistry } from "@laratype/core";
import { bootProviders, HTTP_APP } from "@laratype/support";
import type { ServiceProvider } from "@laratype/support";
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
      this.container = new Container({ deps: depsRegistry });
      this.container.instance(HTTP_APP, this.getInstance());
    }
    return this.container
  }

  /**
   * Boots the providers (the app's, from `register()`, by default). On failure the providers' `down()` has run and the
   * Hono instance and container are reset, so a dev restart never reuses a half-booted app.
   */
  public static async bootProvider(providers?: Array<typeof ServiceProvider>) {
    try {
      return await bootProviders(this.getContainer(), providers ?? await register());
    } catch (error) {
      this.down();
      throw error;
    }
  }

  /**
   * Runs every cleanup (the `down()` list from `bootProvider()`), then always resets the app with `down()`, so the next
   * boot never reuses a stale Hono app or container. Errors are collected and thrown after the reset.
   */
  public static async stop(cleanups: ReadonlyArray<() => unknown>) {
    const errors: unknown[] = [];
    try {
      for (const cleanup of cleanups) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      this.down();
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Serve.stop: several cleanups failed");
  }

  public static down() {
    this.instance = null;
    this.container = null;
  }
}
