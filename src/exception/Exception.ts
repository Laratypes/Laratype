export default class Exception extends Error {
  
  protected code = "UNKNOWN"
  protected httpCode = 500;
  protected responsible = false;

  constructor({
    code = "",
    message = "",
    httpCode = 500,
    responsible = false,
  }) {
    super(message)
    this.code = code
    this.httpCode = httpCode
    this.responsible = responsible
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