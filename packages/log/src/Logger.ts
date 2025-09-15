import { dirname, resolve } from "path";
import { existsSync, mkdirSync } from "fs";

import winston from "winston";
import { LaratypeConfig as Config } from "@laratype/support";
import DriverNotImplement from "./exceptions/DriverNotImplement";

type Driver = Config.Logging.CHANNEL

export default class Logger {
  protected driver: Driver
  protected storagePath: string
  protected logStream: winston.Logger | null = null

  constructor(driver: Driver, storagePath: string) {
    this.driver = driver
    this.storagePath = storagePath
    this.create()
  }

  public getDriver() {
    return this.driver
  }

  public getStoragePath() {
    return this.storagePath
  }

  public getLogFilePath() {
    if(this.driver === "single") {
      const path = resolve(this.storagePath);
      this.makeDirectoryIfNotExists(path);
      return path;
    }
    throw new DriverNotImplement();
  }

  public makeDirectoryIfNotExists(path: string){
    const dirPath = dirname(path);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  public create() {
    if(this.driver === "single") {
      this.logStream = winston.createLogger({
        transports: [
          new winston.transports.File({
            filename: this.getLogFilePath(),
            handleExceptions: true
          })
        ]
      });
    }
  }

  public log(level: string, message: string) {
    this.logStream?.log({
      level,
      message,
    })
  }

  public getLogStream() {
    return this.logStream;
  } 
}
