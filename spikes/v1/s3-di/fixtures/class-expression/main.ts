import { Container, assertEqual } from 'virtual:laratype/di';

class Dep {}
const identity = <T>(x: T) => x;

export const Expr = class {
  constructor(public dep: Dep) {}
};

export const Wrapped = identity(
  class {
    constructor(public dep: Dep) {}
  },
);

const c = new Container();
assertEqual(c.resolve<InstanceType<typeof Expr>>(Expr).dep instanceof Dep, true, 'const X = class {}');
assertEqual(Expr.name, 'Expr', 'const X = class {} keeps name inference');
assertEqual(c.resolve<InstanceType<typeof Wrapped>>(Wrapped).dep instanceof Dep, true, 'class expression as argument');
assertEqual(Wrapped.name, '', 'wrapped class expression has an empty name (it was "" before too)');
