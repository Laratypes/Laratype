import { Exception, ExceptionConstructorParams } from "@laratype/support";

export default class UnauthorizedException extends Exception {

  constructor({
      httpCode = 401,
      message = "",
      code = "UNAUTHORIZED",
      responsible = true,
    }: ExceptionConstructorParams) {
      super({
        code,
        httpCode,
        message,
        responsible
      })
    }
  
    public toJson() {
      return {
        code: this.code,
        message: this.message,
      }
    }
  
}
