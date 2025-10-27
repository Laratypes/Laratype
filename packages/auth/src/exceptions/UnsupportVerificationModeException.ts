import { Exception, ExceptionConstructorParams } from "@laratype/support";

export default class UnsupportedVerificationModeException extends Exception {

  constructor({
      httpCode = 500,
      message = "",
      code = "UNSUPPORT_VERIFICATION_MODE",
      responsible = false,
    }: ExceptionConstructorParams = {}) {
      super({
        code,
        httpCode,
        message,
        responsible
      })
    }
  
}
