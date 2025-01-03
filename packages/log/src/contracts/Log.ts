
export interface LoggerInterface {
  info(message: string): void;

  error(message: string): void;

  warn(message: string): void;

  debug(message: string): void;

  emergency(message: string): void;

  alert(message: string): void;

  critical(message: string): void;
}
