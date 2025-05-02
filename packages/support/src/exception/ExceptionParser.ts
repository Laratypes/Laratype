
export default class ExceptionParser {
  public static parse(exception: Error): string {
    const stack = exception.stack?.split("\n").slice(1).map(line => line.trim()).join("\n");
    const message = exception.message;
    return `Exception: ${message}\nStack:\n${stack ? stack : "No stack trace available"}`;
  }
  
  public static parseWithCode(exception: Error, code: string): string {
    const parsedException = this.parse(exception);
    return `${parsedException}\nCode: ${code}`;
  }
  
  public static parseWithCodeAndMessage(exception: Error, code: string, message: string): string {
    const parsedException = this.parseWithCode(exception, code);
    return `${parsedException}\nMessage: ${message}`;
  } 
}