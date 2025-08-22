import { Hono } from "hono"
import { serve } from '@hono/node-server'
import { boot } from "./bootstrap";
import { Console } from "@laratype/console";
import { ExceptionParser } from "@laratype/support";

export default class Serve {
  
  private static instance: Hono|null = null

  protected static port: number = 3000;

  protected static host: string = 'localhost';

  public static getInstance() {
    if(!this.instance) this.instance = new Hono();
    return this.instance
  }

  public static async create(port?: number, host?: string) {
    const instance = this.getInstance();

    this.port = port || this.port;
    this.host = host || this.host;

    return await this.bootProvider()
    .then(() => {
      serve({
        fetch: instance.fetch,
        port: this.port,
        hostname: this.host,
      })
      Console.log(`Server started at port ${this.port}`)
      return instance
    }).catch((e) => {
      Console.error(ExceptionParser.parse(e));
    });
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