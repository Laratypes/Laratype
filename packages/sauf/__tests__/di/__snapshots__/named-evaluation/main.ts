import { __laratype_deps } from "virtual:laratype/di";
import { Container, hasOwnDeps, assertEqual } from 'virtual:laratype/di';

class Dep {}

let Assigned: any;
Assigned = __laratype_deps({ "Assigned": class {
  constructor(public dep: Dep) {}
} }["Assigned"], [() => Dep], { params: ["dep"] });

let Fallback: any = null;
Fallback ??= __laratype_deps({ "Fallback": class {
  constructor(public dep: Dep) {}
} }["Fallback"], [() => Dep], { params: ["dep"] });

const registry = {
  Keyed: __laratype_deps({ "Keyed": class {
    constructor(public dep: Dep) {}
  } }["Keyed"], [() => Dep], { params: ["dep"] }),
  'quoted-key': __laratype_deps({ "quoted-key": class {
    constructor(public dep: Dep) {}
  } }["quoted-key"], [() => Dep], { params: ["dep"] }),
};

export class Holder {
  static Inner = __laratype_deps({ "Inner": class {
    constructor(public dep: Dep) {}
  } }["Inner"], [() => Dep], { params: ["dep"] });
}

export const Casted = (__laratype_deps({ "Casted": class {
  constructor(public dep: Dep) {}
} }["Casted"], [() => Dep], { params: ["dep"] })) as new (dep: Dep) => { dep: Dep };

const Named = __laratype_deps(class Own {
  constructor(public dep: Dep) {}
}, [() => Dep], { params: ["dep"] });

const c = new Container();
for (const [cls, name] of [
  [Assigned, 'Assigned'],
  [Fallback, 'Fallback'],
  [registry.Keyed, 'Keyed'],
  [registry['quoted-key'], 'quoted-key'],
  [Holder.Inner, 'Inner'],
  [Casted, 'Casted'],
  [Named, 'Own'],
] as const) {
  assertEqual(cls.name, name, `name inference kept for ${name}`);
  assertEqual(hasOwnDeps(cls), true, `${name} registered`);
  assertEqual(c.resolve<any>(cls).dep instanceof Dep, true, `${name} resolves its dep`);
}
