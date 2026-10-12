import { __laratype_deps, getDeps, hasOwnDeps, assertEqual } from 'virtual:laratype/di';

// The D2 runtime shape the transform targets: a hidden, configurable own property, own entry before parent.
const KEY = Symbol.for('laratype.di.deps');

class Dep {}

export class Parent {
  constructor(public dep: Dep) {}
}
export class Child extends Parent {}

const own = Object.getOwnPropertyDescriptor(Parent, KEY)!;
assertEqual(own.enumerable, false, 'deps entry is not enumerable');
assertEqual(own.configurable, true, 'deps entry is configurable (HMR can redefine it)');
assertEqual(Object.keys(Parent).length, 0, 'no visible static keys added');
assertEqual(Object.prototype.hasOwnProperty.call(Child, KEY), false, 'no own entry without an own constructor');
assertEqual(getDeps(Child)!.owner, Parent, 'lookup walks to the parent only when there is no own entry');

// Direct calls: returns the class, meta is optional, a later call replaces the entry.
class Manual {}
assertEqual(__laratype_deps(Manual, []), Manual, '__laratype_deps returns the class');
assertEqual(getDeps(Manual)!.entry.meta, undefined, 'meta is optional');
__laratype_deps(Manual, [() => Dep], { params: ['dep'] });
assertEqual(getDeps(Manual)!.entry.slots.length, 1, 'redefining replaces the entry');
assertEqual(hasOwnDeps(Manual), true, 'own entry');
