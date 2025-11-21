import { Runner } from "./Runner";

export default class ProductionRunner implements Runner {

  ssrLoadModule(modulePath: string): Promise<any> {
    return import(modulePath);
  }

  async close(): Promise<void> {
    return;
  }

  async listen(): Promise<void> {
    throw new Error("ProductionRunner does not support listen().");
  }
}