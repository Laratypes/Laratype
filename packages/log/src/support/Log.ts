import { Config } from "@laratype/support";
import { Facade, Injectable } from "@laratype/core";
import { format } from "winston";

import Logger from "../Logger";
import DriverNotImplement from "../exceptions/DriverNotImplement";

const { combine, timestamp, label, printf } = format;

/** The implementation behind the `Log` facade: one logger per container, created on first use. */
@Injectable({ scope: 'singleton' })
export class LogManager {

  protected logger: Logger | null = null;
  public getLogger() {
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
    return this.root().getLogger();
  }

  public static format(): any {
    return this.root().format();
  }

  public static info(message: any): void {
    this.root().info(message);
  }
  public static error(message: any): void {
    this.root().error(message);
  }
  public static warn(message: any): void {
    this.root().warn(message);
  }
  public static debug(message: any): void {
    this.root().debug(message);
  }
  public static emergency(message: any): void {
    this.root().emergency(message);
  }
  public static alert(message: any): void {
    this.root().alert(message);
  }
  public static critical(message: any): void {
    this.root().critical(message);
  }

}
