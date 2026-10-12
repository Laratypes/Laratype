import { Container, Inject, Inject as Use, assertEqual } from 'virtual:laratype/di';
import type { Mailer } from './tokens.js';
import { MAILER, APP_NAME } from './tokens.js';

class Clock {}

export class Notifier {
  constructor(
    @Inject(MAILER) private mailer: Mailer,
    @Use(APP_NAME) public appName: string,
    public clock: Clock,
  ) {}
  notify() {
    return this.mailer.send(this.appName);
  }
}

const c = new Container()
  .bind(MAILER, { send: (to: string) => `sent:${to}` })
  .bind(APP_NAME, 'laratype');
const n = c.resolve<Notifier>(Notifier);
assertEqual(n.notify(), 'sent:laratype', '@Inject token for interface + aliased @Inject for primitive');
assertEqual(n.clock instanceof Clock, true, 'param after @Inject params keeps its index');
