import { IControllerMethod, safeMethods } from ".."

export default class Controller{

  constructor() {

  }

  public exposed() {
    return []
  }
  
  public __invoke(k: safeMethods<this>) {
    return [this, k];
  }

}