import { Config } from "@laratype/support";
import dayjs from "dayjs";
import { format } from "winston";

import Logger from "../Logger";
import DriverNotImplement from "../exceptions/DriverNotImplement";

const { combine, timestamp, label, printf } = format;

export default class Log {
  
  protected static logger: Logger | null = null;
  public static getLogger() {
    const driver = Config.get(['logging', 'default'] as const);
    if(!driver) {
      throw new DriverNotImplement();
    }
    if(this.logger == null) {
      this.logger = new Logger(driver, "./storage/logs/laratype.log")

      this.logger.getLogStream()!.format = combine(
        label({ label: Config.get(['env'] as const) }),
        timestamp(),
        this.format()
      )
    }

    return this.logger;
  }

  public static format(): any {
    return printf(({ level, message, label, timestamp }) => {
      return `[${timestamp}] [${label}] ${level}: ${message}`;
    })
  }

  public static info(message: any): void {
    this.getLogger().log("info", message);
  }
  public static error(message: any): void {
    this.getLogger().log("error", message);
  }
  public static warn(message: any): void {
    this.getLogger().log("warn", message);
  }
  public static debug(message: any): void {
    this.getLogger().log("debug", message);
  }
  public static emergency(message: any): void {
    this.getLogger().log("emergency", message);
  }
  public static alert(message: any): void {
    this.getLogger().log("alert", message);
  }
  public static critical(message: any): void {
    this.getLogger().log("critical", message);
  }

}
