import type { Context } from "hono"
import type Request from "../request/Request"
import { IControllerMethod, safeMethods } from ".."

export default class Controller implements IControllerMethod {

  constructor() {

  }

  private example(c: Context, req: Request) {
    return c.json({})
  }

  public exposed() {
    return []
  }
  
  public __invoke(k: safeMethods<this>) {
    return {
      'self' : this,
      'invoke': k,
    }
  }
}