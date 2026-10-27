import { Console } from "@laratype/console";
import type { StatusCode } from "hono/utils/http-status";

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
      Console.error(this.message, this.stack)
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

/** Brand of an `Exception`, a `Symbol.for` key so the exception filter recognizes one from another copy of the package (#108). */
const EXCEPTION: unique symbol = Symbol.for("laratype.exception");

// On the prototype, so every subclass carries it without a constructor change
Object.defineProperty(Exception.prototype, EXCEPTION, { value: true });

/**
 * Whether `value` is an `Exception`, by its brand (not `instanceof`), so one from another copy of the package counts.
 * Its public methods are checked too, so the narrowed value has every one of them.
 */
export const isException = (value: unknown): value is Exception => {
  if (typeof value !== "object" || value === null || (value as Record<symbol, unknown>)[EXCEPTION] !== true) return false;
  const methods = value as Partial<Record<"getErrorCode" | "getHttpCode" | "canResponsible" | "toJson", unknown>>;
  return typeof methods.getErrorCode === "function" && typeof methods.getHttpCode === "function" &&
    typeof methods.canResponsible === "function" && typeof methods.toJson === "function";
};

export interface ExceptionConstructorParams {
  code?: string,
  message?: string,
  httpCode?: StatusCode,
  errors?: unknown[],
  responsible?: boolean,
}