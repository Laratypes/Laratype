import { Container, getDeps, hasOwnDeps, assertEqual } from 'virtual:laratype/di';

class Clock {}

export class Overloads {
  constructor(clock: Clock);
  constructor(clock: Clock, label: string);
  constructor(public clock: Clock, public label?: string) {}
}

export abstract class Base {
  constructor(public clock: Clock) {}
}
export class FromAbstract extends Base {}

export class Params {
  public rest: unknown[];
  constructor(public clock: Clock = new Clock(), public count?: number, { tag }: { tag?: string } = {}, ...rest: unknown[]) {
    this.rest = rest;
    void tag;
  }
}

export class PassThrough extends Params {
  constructor(...args: any[]) {
    super(...args);
  }
}

const c = new Container();
const clock = c.resolve<Clock>(Clock);
const o = c.resolve<Overloads>(Overloads);
assertEqual(o.clock === clock && o.label === undefined, true, 'overloads use the implementation signature');
assertEqual(c.resolve<FromAbstract>(FromAbstract).clock, clock, 'abstract parent deps inherited');
const p = c.resolve<Params>(Params);
assertEqual(p.clock === clock && p.count === undefined && p.rest.length === 0, true, 'default/optional/destructured/rest');
assertEqual(getDeps(Params)!.entry.slots.length, 3, 'trailing rest gets no slot');
assertEqual(hasOwnDeps(PassThrough), false, '`constructor(...args)` pass-through inherits');
assertEqual(c.resolve<PassThrough>(PassThrough).clock, clock, 'pass-through resolves via the parent');
