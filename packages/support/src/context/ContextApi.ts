import { AsyncLocalStorage } from "async_hooks";
import type { Request } from "@laratype/http"; 

export default class ContextApi {

  static getRequestStore() {
    return globalThis.requestGlobalStore ??= new AsyncLocalStorage();
  }

  static getRequest() {
    const requestStore = this.getRequestStore().getStore();
    if(!requestStore) {
      throw new Error("Request store is not available. Make sure you are using ContextApi inside a request context.");
    }
    return requestStore.request;
  }

  static getUser<U>() {
    return this.getRequestStore().getStore()?.user as U | undefined;
  }

  static setUser(user: unknown) {
    const store = this.getRequestStore().getStore();
    if(store) {
      store.user = user;
    }
  }

  static setRequest(request: Request) {
    const store = this.getRequestStore().getStore();
    if(store) {
      store.request = request;
    }
  }

  static run(ctx: ReturnType<typeof globalThis.requestGlobalStore.getStore>, callback: (...args: any[]) => void) {
    if(!ctx) {
      throw new Error("Request context is not available. Make sure you are using ContextApi inside a request context.");
    }
    return this.getRequestStore().run(ctx, callback);
  }

}