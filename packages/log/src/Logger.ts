import { dirname, resolve } from "path";
import { createWriteStream, existsSync, mkdirSync, WriteStream } from "fs";
import DriverNotImplement from "./exceptions/DriverNotImplement";
import { LaratypeConfig as Config } from "@laratype/support";

type Driver = Config.Logging.CHANNEL

export default class Logger {
  protected driver: Driver
  protected storagePath: string
  protected logStream: WriteStream | null = null

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
      this.logStream = createWriteStream(this.getLogFilePath(), {
        flags: 'a',
        encoding: 'utf8'
      })
    }
  }

  public log(message: string) {
    this.logStream?.write(message)
  }
}