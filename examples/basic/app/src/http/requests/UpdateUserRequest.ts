import { Request } from "@laratype/http";
import { z } from "zod";
export default class UpdateUserRequest extends Request {
  public rules() {
    return z.object({
      email: z.string().optional(),
      name: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      age: z.number().min(18).optional()
    })
  }
}