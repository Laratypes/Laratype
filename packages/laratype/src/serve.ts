import { serve } from '@hono/node-server'
import { register } from "./bootstrap";
import { Console } from "@laratype/console";
import { ExceptionParser, Hono } from "@laratype/support";

export default class Serve {
  
  private static instance: Hono|null = null

  protected static port: number = 3000;

  protected static host: string = 'localhost';

  public static getInstance() {
    if(!this.instance) this.instance = new Hono();
    return this.instance
  }

  public static async create(vite: any, port?: number, host?: string) {
    const instance = this.getInstance();

    this.port = port || this.port;
    this.host = host || this.host;

    return await this.bootProvider(vite)
    .then(() => {
      serve({
        fetch: instance.fetch,
        port: this.port,
        hostname: this.host,
      })
      return instance
    }).catch((e) => {
      Console.error(ExceptionParser.parse(e));
    });
  }

  public static async bootProvider(vite: any) {
    const instance = this.getInstance()
    const serviceProviderBootstrapped = await register()
    for(let Provider of serviceProviderBootstrapped) {
      const handler = new Provider(vite, instance).boot()
      if(handler instanceof Promise) {
        await handler;
      }
    }
  }

}