import { token } from '@laratype/core';

export interface Mailer {
  send(to: string): string;
}
export const MAILER = token<Mailer>('Mailer');
export const APP_NAME = token<string>('app.name');
