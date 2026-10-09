import { __laratype_deps } from "virtual:laratype/di";
import { Container, getDeps, assertEqual } from 'virtual:laratype/di';
import * as ns from './ns.js';

export class Dep {}

export namespace Services {
  export class InNamespace {
    constructor(public dep: Dep, public mailer: ns.Mailer) {}
  }
__laratype_deps(InNamespace, [() => Dep, () => ns.Mailer], { params: ["dep","mailer"] });
}

export function make<T>(Dep: number) {
  class Local {}
  class UsesLocal {
    constructor(public local: Local, public generic: T) {}
  }
__laratype_deps(UsesLocal, [() => Local, { unresolved: "T", index: 1 }], { params: ["local","generic"] });
  // The param `Dep` shadows the class at runtime, so the slot must stay unresolved.
  class Shadowed {
    constructor(public dep: Dep) {}
  }
__laratype_deps(Shadowed, [{ unresolved: "Dep", index: 0 }], { params: ["dep"] });
  return { UsesLocal, Shadowed, Local };
}

const c = new Container();
const s = c.resolve<Services.InNamespace>(Services.InNamespace);
assertEqual(s.dep instanceof Dep && s.mailer instanceof ns.Mailer, true, 'namespace class + qualified import type');
const { UsesLocal, Shadowed, Local } = make<string>(1);
const kinds = (cls: Function) =>
  getDeps(cls)!.entry.slots.map((slot) => (typeof slot === 'function' ? 'thunk' : slot.unresolved)).join(',');
assertEqual(kinds(UsesLocal), 'thunk,T', 'function-local class + function type param');
assertEqual(kinds(Shadowed), 'Dep', 'param shadowing the class');
void Local;
