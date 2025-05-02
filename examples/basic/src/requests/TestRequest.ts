import { Request } from "@laratype/http"
import { z } from "zod"
export default class TestRequest extends Request {

  public rules() {
    return z.object({
      test: z.string(),
    })
  }
}