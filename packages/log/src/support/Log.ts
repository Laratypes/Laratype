import { Config } from "@laratype/support";
import Logger from "../Logger";
import dayjs from "dayjs"
import DriverNotImplement from "../exceptions/DriverNotImplement";

export default class Log {
  
  protected static logger: Logger | null = null;
  public static getLogger() {
    const driver = Config.get(['logging', 'default'] as const);
    if(!driver) {
      throw new DriverNotImplement();
    }
    if(this.logger == null) {
      this.logger = new Logger(driver, "./storage/logs/laratype.log")
    }
    return this.logger;
  }

  public static format(level: string, ...messages: any[]) {
    return `[${dayjs.tz().toISOString()}] [${level}] [${Config.get(['env'] as const)}] ${messages.join("\n")}\n`;
  }

  public static info(message: any): void {
    this.getLogger().log(this.format("INFO", message));
  }
  public static error(message: any, stack?: any): void {
    this.getLogger().log(this.format("ERROR", message, stack));
  }
  public static warn(message: any): void {
    this.getLogger().log(this.format("WARN", message));
  }
  public static debug(message: any): void {
    this.getLogger().log(this.format("DEBUG", message));
  }
  public static emergency(message: any): void {
    this.getLogger().log(this.format("EMERGENCY", message));
  }
  public static alert(message: any): void {
    this.getLogger().log(this.format("ALERT", message));
  }
  public static critical(message: any): void {
    this.getLogger().log(this.format("CRITICAL", message));
  }

}