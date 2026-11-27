import { AsyncLocalStorage } from "async_hooks";
import type { Request } from "@laratype/http"; 
import { appContainer } from "@laratype/core";
import type { Container } from "@laratype/core";

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

  static setModelBindings(modelBindings: Record<string, any>) {
    const store = this.getRequestStore().getStore();
    if(store) {
      store.modelBindings = modelBindings;
    }
  }

  static getModelBindings(): Record<string, any> {
    return this.getRequestStore().getStore()?.modelBindings ?? {};
  }

  /**
   * The container of the current request scope (D6 #112), set by `RequestKernel`, else the app container
   * (`appContainer()`, D11 #318). Always a container: to tell whether a request is active, read the request store
   * (`getRequestStore().getStore()`) instead of comparing this to `undefined`.
   */
  static getContainer(): Container {
    return this.getRequestStore().getStore()?.container ?? appContainer();
  }

  static setRequest(request: Request) {
    const store = this.getRequestStore().getStore();
    if(store) {
      store.request = request;
    }
  }

  static run(ctx: ReturnType<ReturnType<typeof ContextApi.getRequestStore>["getStore"]>, callback: (...args: any[]) => void) {
    if(!ctx) {
      throw new Error("Request context is not available. Make sure you are using ContextApi inside a request context.");
    }
    return this.getRequestStore().run(ctx, callback);
  }

}
