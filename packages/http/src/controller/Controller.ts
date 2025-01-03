import { safeMethods } from "../contracts/Controller";

export default class Controller {

  constructor() {

  }

  public exposed() {
    return []
  }
  
  public __invoke(k: safeMethods<this>) {
    return [this, k];
  }

}