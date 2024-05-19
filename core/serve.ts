import { Hono } from "hono"
import { serve } from '@hono/node-server'
import config from "../config/config"

export default class Serve {
  
  private instance: Hono|null = null

  protected constructor() {

  }

  public getInstance() {
    if(!this.instance) this.instance = new Hono();
    return this.instance
  }

  public create() {
    const instance = this.getInstance();

    serve({
      fetch: instance.fetch,
      port: 3000,
    })

    this.bootProvider()
    return instance
  }

  public bootProvider() {
    const instance = this.getInstance()
    config.providers.forEach((Provider) => {
      new Provider(instance).boot()
    })
  }

}