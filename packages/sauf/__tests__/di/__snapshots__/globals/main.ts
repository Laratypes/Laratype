import { __laratype_deps } from "virtual:laratype/di";
import { Container, getDeps, assertEqual, assertThrows } from 'virtual:laratype/di';

export class Dates {
  constructor(public date: Date, public cache: Map<string, number>, public later: Promise<void>) {}
}
__laratype_deps(Dates, [{ unresolved: "Date", index: 0 }, { unresolved: "Map<string, number>", index: 1 }, { unresolved: "Promise<void>", index: 2 }], { params: ["date","cache","later"] });

const kinds = getDeps(Dates)!.entry.slots.map((slot) => (typeof slot === 'function' ? 'thunk' : slot.unresolved));
assertEqual(kinds.join(','), 'Date,Map<string, number>,Promise<void>', 'globals stay unresolved');
assertThrows(
  () => new Container().resolve(Dates),
  /Cannot resolve Dates constructor param #0 `date`: type `Date` has no runtime value/,
  'no silent `new Date()`',
);
const d = new Container().bind(Dates, 'bound').resolve(Dates);
assertEqual(d, 'bound', 'binding the class itself is the escape hatch');
