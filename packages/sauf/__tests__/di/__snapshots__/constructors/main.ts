import { __laratype_deps } from "virtual:laratype/di";
import { Container, getDeps, hasOwnDeps, assertEqual } from 'virtual:laratype/di';

class Clock {}

export class Overloads {
  constructor(clock: Clock);
  constructor(clock: Clock, label: string);
  constructor(public clock: Clock, public label?: string) {}
}
__laratype_deps(Overloads, [() => Clock, { unresolved: "string", index: 1 }], { params: ["clock","label"], optional: [1] });

export abstract class Base {
  constructor(public clock: Clock) {}
}
__laratype_deps(Base, [() => Clock], { params: ["clock"] });
export class FromAbstract extends Base {}

export class Params {
  public rest: unknown[];
  constructor(public clock: Clock = new Clock(), public count?: number, { tag }: { tag?: string } = {}, ...rest: unknown[]) {
    this.rest = rest;
    void tag;
  }
}
__laratype_deps(Params, [() => Clock, { unresolved: "number", index: 1 }, { unresolved: "{ tag?: string }", index: 2 }], { params: ["clock","count","#2"], optional: [0,1,2] });

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
