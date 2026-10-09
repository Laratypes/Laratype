import { Container, Inject, Injectable, assertEqual } from 'virtual:laratype/di';
// Interface imported WITHOUT `type`. Our transform only references MAILER (the token)...
import { Mailer, MAILER } from './types.js';

@Injectable()
export class Notifier {
  // ...but SWC `decoratorMetadata` emits design:paramtypes = [typeof Mailer === "undefined" ? Object : Mailer].
  constructor(@Inject(MAILER) public mailer: Mailer) {}
}

const n = new Container().bind(MAILER, { send: (to: string) => to }).resolve<Notifier>(Notifier);
assertEqual(n.mailer.send('ok'), 'ok', 'resolves when decoratorMetadata is off');
