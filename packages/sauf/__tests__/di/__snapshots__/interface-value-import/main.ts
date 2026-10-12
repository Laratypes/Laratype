import { __laratype_deps } from "virtual:laratype/di";
import { Container } from 'virtual:laratype/di';
// Interface imported WITHOUT `type` (TS1484 under verbatimModuleSyntax).
import { Mailer } from './types.js';

export class Notifier {
  constructor(public mailer: Mailer) {}
}
__laratype_deps(Notifier, [() => Mailer], { params: ["mailer"] });

new Container().resolve(Notifier);
