import { ContextApi } from "@laratype/support";

export default class Auth {
  static attempt<T>(user: T): Promise<boolean> {
    throw new Error("Method not implemented.");
  }

  static user<T>() {
    return ContextApi.getUser<T>();
  }

  static id<A>(): A {
    throw new Error("Method not implemented.");
  }

  static isAuthenticated(): boolean {
    throw new Error("Method not implemented.");
  }

  static check(): boolean {
    throw new Error("Method not implemented.");
  }

  static login<T>(user: T): Promise<T> {
    throw new Error("Method not implemented.");
  }

  static guard(route: string): typeof Auth {
    throw new Error("Method not implemented.");
  }

  static logout(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  
}
