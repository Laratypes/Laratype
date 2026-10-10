import { Container } from 'virtual:laratype/di';
// Interface imported WITHOUT `type` (TS1484 under verbatimModuleSyntax).
import { Mailer } from './types.js';

export class Notifier {
  constructor(public mailer: Mailer) {}
}

new Container().resolve(Notifier);
