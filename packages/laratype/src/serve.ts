import { Hono } from "hono"
import { register } from "./bootstrap";

export default class Serve {
  
  private static instance: Hono|null = null

  protected static port: number = 3000;

  protected static host: string = 'localhost';

  public static getInstance() {
    if(!this.instance) this.instance = new Hono();
    return this.instance
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