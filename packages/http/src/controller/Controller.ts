import { safeMethods } from "../contracts/Controller";

export default class Controller {

  constructor() {

  }

  public exposed() {
    return []
  }
  

  static __invoke<T extends Controller>(this: new () => T, k: safeMethods<T>): [T, safeMethods<T>];
  static __invoke<T extends Controller>(k: safeMethods<T>) {
    return [this, k];
  }
  
}
