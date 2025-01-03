import { Hono } from "hono"
import { serve } from '@hono/node-server'
import { boot } from "./bootstrap";

export default class Serve {
  
  private static instance: Hono|null = null

  protected static port: number = 3000;

  public static getInstance() {
    if(!this.instance) this.instance = new Hono();
    return this.instance
  }

  public static async create() {
    const instance = this.getInstance();

    serve({
      fetch: instance.fetch,
      port: this.port,
    })

    await this.bootProvider()
    console.log(`Server started at port ${this.port}`);
    
    return instance
  }

  public static async bootProvider() {
    const instance = this.getInstance()
    const serviceProviderBootstrapped = await boot()
    for(let Provider of serviceProviderBootstrapped) {
      const handler = new Provider(instance).boot()
      if(handler instanceof Promise) {
        await handler;
      }
    }
  }

}