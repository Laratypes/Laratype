import { __laratype_deps } from "virtual:laratype/di";
import { Container, assertEqual } from 'virtual:laratype/di';

class Clock {
  source = 'container';
}

export class Retry {
  constructor(public clock: Clock = Object.assign(new Clock(), { source: 'default' }), public retries: number = 3) {}
}
__laratype_deps(Retry, [() => Clock, { unresolved: "number", index: 1 }], { params: ["clock","retries"], optional: [0,1] });

const r = new Container().resolve<Retry>(Retry);
assertEqual(r.clock.source, 'container', 'class-typed default param is injected (default ignored)');
assertEqual(r.retries, 3, 'unresolvable default param receives undefined so the default applies');
