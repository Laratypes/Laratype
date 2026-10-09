import { Container, hasOwnDeps, assertEqual } from 'virtual:laratype/di';

class Dep {}

let Assigned: any;
Assigned = class {
  constructor(public dep: Dep) {}
};

let Fallback: any = null;
Fallback ??= class {
  constructor(public dep: Dep) {}
};

const registry = {
  Keyed: class {
    constructor(public dep: Dep) {}
  },
  'quoted-key': class {
    constructor(public dep: Dep) {}
  },
};

export class Holder {
  static Inner = class {
    constructor(public dep: Dep) {}
  };
}

export const Casted = (class {
  constructor(public dep: Dep) {}
}) as new (dep: Dep) => { dep: Dep };

const Named = class Own {
  constructor(public dep: Dep) {}
};

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
