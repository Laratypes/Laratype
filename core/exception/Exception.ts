export default class Exception extends Error {
  
  protected code = "UNKNOWN"
  protected httpCode = 500;

  constructor({
    code = "",
    message = "",
    httpCode = 500
  }) {
    super(message)
    this.code = code
    this.httpCode = httpCode
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
  
  public toJson() {
    return {
      code: this.code,
      message: this.message,
    }
  }
}