
export default class Console {
  public static log(...args: any) {
    console.log(...args);
  }
  
  public static error(...args: any) {
    console.error(...args);
  }
  
  public static debug(...args: any) {
    console.debug(...args);
  }
  
  public static info(...args: any) {
    console.info(...args);
  }
  
  public static warn(...args: any) {
    console.warn(...args);
  }
  
  public static table(...args: any) {
    console.table(...args);
  }
  
}