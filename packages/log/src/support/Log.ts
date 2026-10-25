import { Config } from "@laratype/support";
import { Facade } from "@laratype/core";
import { format } from "winston";

import Logger from "../Logger";
import DriverNotImplement from "../exceptions/DriverNotImplement";

const { combine, timestamp, label, printf } = format;

/** The implementation behind the `Log` facade. The logger is created on first use and shared, as in 0.5. */
export class LogManager {

  protected static logger: Logger | null = null;
  public getLogger() {
    const driver = Config.get(['logging', 'default'] as const);
    if(!driver) {
      throw new DriverNotImplement();
    }
    if(LogManager.logger == null) {
      LogManager.logger = new Logger(driver, "./storage/logs/laratype.log")

      LogManager.logger.getLogStream()!.format = combine(
        label({ label: Config.get(['env'] as const) }),
        timestamp(),
        this.format()
      )
    }

    return LogManager.logger;
  }

  public format(): any {
    return printf(({ level, message, label, timestamp }) => {
      return `[${timestamp}] [${label}] ${level}: ${message}`;
    })
  }

  public info(message: any): void {
    this.getLogger().log("info", message);
  }
  public error(message: any): void {
    this.getLogger().log("error", message);
  }
  public warn(message: any): void {
    this.getLogger().log("warn", message);
  }
  public debug(message: any): void {
    this.getLogger().log("debug", message);
  }
  public emergency(message: any): void {
    this.getLogger().log("emergency", message);
  }
  public alert(message: any): void {
    this.getLogger().log("alert", message);
  }
  public critical(message: any): void {
    this.getLogger().log("critical", message);
  }

}

export default class Log extends Facade {
  static override readonly accessor = LogManager;

  public static getLogger() {
    return Log.root().getLogger();
  }

  public static format(): any {
    return Log.root().format();
  }

  public static info(message: any): void {
    Log.root().info(message);
  }
  public static error(message: any): void {
    Log.root().error(message);
  }
  public static warn(message: any): void {
    Log.root().warn(message);
  }
  public static debug(message: any): void {
    Log.root().debug(message);
  }
  public static emergency(message: any): void {
    Log.root().emergency(message);
  }
  public static alert(message: any): void {
    Log.root().alert(message);
  }
  public static critical(message: any): void {
    Log.root().critical(message);
  }

}
