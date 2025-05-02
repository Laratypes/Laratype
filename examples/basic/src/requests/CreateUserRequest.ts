import { Request } from "@laratype/http";
import { z } from "zod";
export default class CreateUserRequest extends Request {
  public rules() {
    return z.object({
      email: z.string(),
      password: z.string().min(8),
      name: z.string(),
    })
  }
}