import { Request } from "@laratype/core"
import { z } from "zod"
export default class TestRequest extends Request {

  public rules() {
    return z.object({
      test: z.string(),
    })
  }
}