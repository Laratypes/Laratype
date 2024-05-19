import Exception from "./Exception";

export default class Exceptions extends Exception {

  protected errors: any[] = []

  constructor({
    httpCode = 500,
    message = "",
    code = "",
    errors = [] as any[]
  }) {
    super({
      code,
      httpCode,
      message
    })
    this.errors = errors;
  }

  public get getErrors() {
    return this.errors
  }
  
  public toJson() {
      return {
        code: this.code,
        message: this.message,
        errors: this.errors,
      }
  }
}