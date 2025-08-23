import { consola } from "consola";


export default class Console {
  public static log(message: any, ...args: any) {
    consola.log(message, ...args);
  }

  public static error(message: any, ...args: any) {
    consola.error(message, ...args);
  }

  public static debug(message: any, ...args: any) {
    consola.debug(message, ...args);
  }

  public static info(message: any, ...args: any) {
    consola.info(message, ...args);
  }

  public static warn(message: any, ...args: any) {
    consola.warn(message, ...args);
  }
  
  public static table(...args: any) {
    console.table(...args);
  }

  public static success(message: any, ...args: any) {
    consola.success(message, ...args);
  }

  public static box(message: any, ...args: any) {
    consola.box(message, ...args);
  }

  public static start(message: any, ...args: any) {
    consola.start(message, ...args);
  }

}