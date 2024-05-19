import { Schema } from "express-validator"
import Request from "../../core/request/Request"

export default class TestRequest extends Request {

  public rules(): ReturnType<Request['rules']> {
      return {
        test: {
          isStrongPassword: true,
          in: ["query"],
        }
      }
  }
}