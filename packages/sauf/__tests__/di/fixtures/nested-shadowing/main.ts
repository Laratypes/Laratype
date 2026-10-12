import { Container, getDeps, assertEqual } from 'virtual:laratype/di';

export class Dep {}

export class Box<Dep> {
  constructor(public value: Dep) {}
}

export function makeService() {
  class Local {}
  class Inner {
    constructor(public local: Local, public dep: Dep) {}
  }
  return { Inner, Local };
}

const slot = getDeps(Box)!.entry.slots[0];
assertEqual(typeof slot === 'object' && slot.unresolved, 'Dep', 'class type param shadows module class Dep');

const { Inner, Local } = makeService();
const inner = new Container().resolve<InstanceType<typeof Inner>>(Inner);
assertEqual(inner.local instanceof Local && inner.dep instanceof Dep, true, 'class nested in a function sees local + module bindings');
