import { Exception, ExceptionConstructorParams } from "@laratype/support";

export default class UnauthorizedException extends Exception {

  constructor({
    httpCode = 403,
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
  
  public toJson() {
    return {
      code: this.code,
      message: this.message,
    }
  }
  
}
