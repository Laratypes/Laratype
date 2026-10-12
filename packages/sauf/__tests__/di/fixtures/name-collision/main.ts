import { Container, hasOwnDeps, assertEqual } from 'virtual:laratype/di';

// User code may use any names, including the transform's internals: the emitted helper is aliased if needed.
function bind<T>(value: T) {
  return value;
}
const __laratype_deps = (cls: unknown) => `user:${String(cls)}`;
const __laratype_deps_1 = 'taken too';

class Dep {}

export class Svc {
  constructor(public dep: Dep) {}
}

export const Expr = bind(class {
  constructor(public dep: Dep) {}
});

assertEqual(hasOwnDeps(Svc) && hasOwnDeps(Expr), true, 'classes registered through the aliased helper');
assertEqual(new Container().resolve<Svc>(Svc).dep instanceof Dep, true, 'Svc resolves');
assertEqual(__laratype_deps('x').startsWith('user:'), true, 'user __laratype_deps untouched');
assertEqual(bind(1), 1, 'user bind untouched');
void __laratype_deps_1;
