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

// A binding named `__proto__` is named through NamedEvaluation; a `__proto__:` property sets the prototype instead.
const __proto__ = class {
  constructor(public dep: Dep) {}
};
const withProto: any = {
  __proto__: class {
    constructor(public dep: Dep) {}
  },
};
const ProtoValue = Object.getPrototypeOf(withProto);

const c = new Container();
for (const [cls, name] of [
  [Assigned, 'Assigned'],
  [Fallback, 'Fallback'],
  [registry.Keyed, 'Keyed'],
  [registry['quoted-key'], 'quoted-key'],
  [Holder.Inner, 'Inner'],
  [Casted, 'Casted'],
  [Named, 'Own'],
  [__proto__, '__proto__'],
  [ProtoValue, ''],
] as const) {
  assertEqual(cls.name, name, `name inference kept for ${name}`);
  assertEqual(hasOwnDeps(cls), true, `${name} registered`);
  assertEqual(c.resolve<any>(cls).dep instanceof Dep, true, `${name} resolves its dep`);
}
