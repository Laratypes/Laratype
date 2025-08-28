import { AsyncLocalStorage } from "async_hooks";
import type Request from "../supports/Request";

export default class TrackingRequestGlobalStore {

  static getRequestStore() {
    return (globalThis as any).requestGlobalStore ??= new AsyncLocalStorage<Request>();
  }

  static getRequest(): Request {
    return this.getRequestStore().getStore();
  }
  
  static run(request: Request, callback: (...args: any[]) => void) {
    return this.getRequestStore().run(request, callback);
  }

}