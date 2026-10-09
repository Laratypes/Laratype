import { __laratype_deps } from "virtual:laratype/di";
import { getDeps, assertEqual } from 'virtual:laratype/di';

export class Dep {}

export function build() {
  if (Math.random() < 2) {
    // `var` is hoisted to the function: inside `build`, the VALUE `Dep` is this string,
    // while the TYPE `Dep` below still means the module class. A `() => Dep` thunk would return the string.
    var Dep = 'shadowed';
    void Dep;
  }
  class Service {
    constructor(public dep: Dep) {}
  }
__laratype_deps(Service, [{ unresolved: "Dep", index: 0 }], { params: ["dep"] });
  return Service;
}

const slot = getDeps(build())!.entry.slots[0];
assertEqual(typeof slot === 'object' && slot.unresolved, 'Dep', 'hoisted var shadowing a class makes the slot unresolved');
