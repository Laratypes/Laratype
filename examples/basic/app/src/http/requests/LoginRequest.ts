import { Request } from "@laratype/http";
import { z } from "zod";

export default class LoginRequest extends Request {

  // Define the validation rules for the request
  public rules() {
    return z.object({
      email: z.string(),
      password: z.string(),
    })
  }
}
