import { Hono } from "hono"
import { serve } from '@hono/node-server'
import { boot } from "./bootstrap";

export default class Serve {
  
  private instance: Hono|null = null

  protected constructor() {

  }

  public getInstance() {
    if(!this.instance) this.instance = new Hono();
    return this.instance
  }

  public async create() {
    const instance = this.getInstance();

    serve({
      fetch: instance.fetch,
      port: 3000,
    })

    await this.bootProvider()
    return instance
  }

  public async bootProvider() {
    const instance = this.getInstance()
    const serviceProviderBootstrapped = await boot()
    serviceProviderBootstrapped.forEach((Provider) => {
      new Provider(instance).boot()
    })
  }

}