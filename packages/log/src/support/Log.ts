import { Config } from "@laratype/support";
import type { LaratypeConfig } from "@laratype/support";
import { Facade, Manager } from "@laratype/core";
import { format } from "winston";

import Logger from "../Logger";
import DriverNotImplement from "../exceptions/DriverNotImplement";

const { combine, timestamp, label, printf } = format;

/** The `logging.channels` keys of app/config/config.ts: the manager's driver names (F1 #160). */
type Channel = LaratypeConfig.Logging.CHANNEL;
/** One 0.5 `Logger` per log channel. */
type ChannelDrivers = { [C in Channel]: Logger };
/** The 0.5 file of the `single` channel. */
const LOG_PATH = "./storage/logs/laratype.log";

/**
 * The implementation behind the `Log` facade: the log channels are drivers of the shared Manager (F1 #160).
 * `getLogger()` keeps the 0.5 call shape and returns the driver of `logging.default`.
 */
export class LogManager extends Manager<ChannelDrivers, LaratypeConfig.Logging.Config["default"]> {

  /** The 0.5 static cache: one file transport per process, whatever the container (D8, di.md). */
  protected static logger: Logger | null = null;

  /** `logging.default` in app/config/config.ts; 0.5's DriverNotImplement when it is not set. */
  protected override get defaultDriver(): LaratypeConfig.Logging.Config["default"] {
    const driver = Config.get(['logging', 'default'] as const);
    if(!driver) {
      throw new DriverNotImplement();
    }
    return driver;
  }

  /** Only `single` is implemented, as in 0.5: `stack` and `daily` throw DriverNotImplement. */
  protected override createDriver(name: Channel): Logger {
    if(name !== "single") {
      throw new DriverNotImplement();
    }
    if(LogManager.logger == null) {
      LogManager.logger = new Logger(LOG_PATH);

      LogManager.logger.getLogStream()!.format = combine(
        label({ label: Config.get(['env'] as const) }),
        timestamp(),
        this.format()
      )
    }

    return LogManager.logger;
  }

  public getLogger(): Logger {
    return this.driver();
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
