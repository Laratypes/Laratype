import { __laratype_deps } from "virtual:laratype/di";
import { Container, getDeps, assertEqual, assertThrows } from 'virtual:laratype/di';
import type { Cache } from './types.js';
import { type Real as RealType, Real } from './types.js';

interface LocalIface {
  x: number;
}
type Alias = { y: string };
enum Mode { A, B }

export class Mixed {
  constructor(
    public real: Real,
    public name: string,
    public local: LocalIface,
    public alias: Alias,
    public cache: Cache,
    public realType: RealType,
    public mode: Mode,
    public date: Date,
    public map: Map<string, number>,
    public either: Real | undefined,
    public union: Real | string,
  ) {}
}
__laratype_deps(Mixed, [() => Real, { unresolved: "string", index: 1 }, { unresolved: "LocalIface", index: 2 }, { unresolved: "Alias", index: 3 }, { unresolved: "Cache", index: 4 }, { unresolved: "RealType", index: 5 }, { unresolved: "Mode", index: 6 }, { unresolved: "Date", index: 7 }, { unresolved: "Map<string, number>", index: 8 }, () => Real, { unresolved: "Real | string", index: 10 }], { params: ["real","name","local","alias","cache","realType","mode","date","map","either","union"], optional: [9] });

export class OptionalPrimitive {
  constructor(public real: Real, public label?: string) {}
}
__laratype_deps(OptionalPrimitive, [() => Real, { unresolved: "string", index: 1 }], { params: ["real","label"], optional: [1] });

const entry = getDeps(Mixed)!.entry;
assertEqual(entry.slots.length, 11, 'no param is skipped');
const kinds = entry.slots.map((s) => (typeof s === 'function' ? 'thunk' : `?${s.unresolved}@${s.index}`)).join(',');
assertEqual(
  kinds,
  'thunk,?string@1,?LocalIface@2,?Alias@3,?Cache@4,?RealType@5,?Mode@6,?Date@7,?Map<string, number>@8,thunk,?Real | string@10',
  'slot kinds',
);

const c = new Container();
assertThrows(
  () => c.resolve(Mixed),
  /Cannot resolve Mixed constructor param #1 `name`: type `string` has no runtime value\. Fix: add @Inject\(token\)/,
  'marker without @Inject throws with class, index, name and hint',
);
const o = c.resolve<OptionalPrimitive>(OptionalPrimitive);
assertEqual(o.label, undefined, 'optional unresolved param gets undefined');
assertEqual(o.real instanceof Real, true, 'optional sibling still resolved');
void Mode.A;
