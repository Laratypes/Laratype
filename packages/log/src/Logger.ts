import { dirname, resolve } from "path";
import { existsSync, mkdirSync } from "fs";

import winston from "winston";

/**
 * The `single` log channel: a winston logger writing one file, created by `LogManager` (0.5's `Logger`, without
 * the channel switch: F1 #160 moved the channels onto the manager).
 */
export default class Logger {
  protected storagePath: string
  protected logStream: winston.Logger | null = null

  constructor(storagePath: string) {
    this.storagePath = storagePath
    this.create()
  }

  public getStoragePath() {
    return this.storagePath
  }

  public getLogFilePath() {
    const path = resolve(this.storagePath);
    this.makeDirectoryIfNotExists(path);
    return path;
  }

  public makeDirectoryIfNotExists(path: string){
    const dirPath = dirname(path);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  public create() {
    this.logStream = winston.createLogger({
      transports: [
        new winston.transports.File({
          filename: this.getLogFilePath(),
          handleExceptions: true
        })
      ]
    });
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
