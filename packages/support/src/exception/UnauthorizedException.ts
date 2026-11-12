import { Exception, type ExceptionConstructorParams } from "./Exception";

/** A request without an authenticated user (0.5 `UnauthorizedException`): 401, `{ code: "UNAUTHORIZED", message }`. */
export class UnauthorizedException extends Exception {

  constructor({
    httpCode = 401,
    message = "You are not authorized to perform this action.",
    code = "UNAUTHORIZED",
    responsible = true,
  }: ExceptionConstructorParams = {}) {
    super({
      code,
      httpCode,
      message,
      responsible,
      reportable: false,
    })
  }

}
