import { StatusCode } from "hono/utils/http-status";
import { Exception } from "./Exception";

export default class Exceptions extends Exception {

  protected errors: any[] = []

  constructor({
    httpCode = 500,
    message = "",
    code = "",
    errors = [],
    responsible = false,
  }: {
      code?: string,
      message?: string,
      httpCode?: StatusCode,
      errors?: unknown[],
      responsible?: boolean,  // Should the exception be handled by the app or returned as a response?
    }) {
    super({
      code,
      httpCode,
      message,
      responsible
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