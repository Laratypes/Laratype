import { Container, Inject, Injectable, assertEqual } from 'virtual:laratype/di';
// Same as metadata-keeps-import, but with `import type` (what verbatimModuleSyntax forces).
import type { Mailer } from './types.js';
import { MAILER } from './types.js';

@Injectable()
export class Notifier {
  // SWC decoratorMetadata still emits `typeof Mailer === "undefined" ? Object : Mailer`, but with no import kept.
  constructor(@Inject(MAILER) public mailer: Mailer) {}
}

const n = new Container().bind(MAILER, { send: (to: string) => to }).resolve<Notifier>(Notifier);
assertEqual(n.mailer.send('ok'), 'ok', 'decoratorMetadata on + import type resolves');
