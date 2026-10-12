import { Container, assertEqual } from 'virtual:laratype/di';

// Tiếng Việt, 日本語, emoji 🚀🧪: UTF-16 offsets must line up for magic-string.
class Dịch {}

export class Café {
  /** ☕ */
  constructor(public dịch: Dịch, public label = '🚀') {}
}

const c = new Container().resolve<Café>(Café);
assertEqual(c.dịch instanceof Dịch, true, 'non-ASCII identifiers and comments');
assertEqual(c.label, '🚀', 'default kept for unresolved param');
