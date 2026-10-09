export interface Mailer {
  send(to: string): string;
}
export const MAILER = Symbol('Mailer');
export const APP_NAME = 'app.name';
