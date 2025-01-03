import { Log } from "@laratype/log";
import { StatusCode } from "hono/utils/http-status";

export class Exception extends Error {
  
  protected code = "UNKNOWN"
  protected httpCode: StatusCode = 500;
  protected responsible = false;
  protected reportable = true;

  constructor({
    code = "",
    message = "",
    httpCode = 500,
    responsible = false,
    reportable = true,
  }: {
    code?: string,
    message?: string,
    httpCode?: StatusCode,
    responsible?: boolean,  // Should the exception be handled by the app or returned as a response?
    reportable?: boolean,  // Should the exception be reported to the error handler?
  }) {
    super(message)
    this.code = code
    this.httpCode = httpCode
    this.responsible = responsible
    this.reportable = reportable
    if(this.reportable) {
      Log.error(this.message, this.stack)
    }
  }

  /**
   * getErrorCode
   */
  public getErrorCode() {
    return this.code    
  }

  public getHttpCode() {
    return this.httpCode
  }
  
  public canResponsible() {
    return this.responsible
  }
  
  public toJson() {
    return {
      code: this.code,
      message: this.message,
    }
  }
}