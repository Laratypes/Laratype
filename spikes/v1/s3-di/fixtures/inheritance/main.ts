import { Container, getDeps, hasOwnDeps, assertEqual } from 'virtual:laratype/di';

class A {}
class B {}

export class Parent {
  constructor(public a: A) {}
}
export class ChildNoCtor extends Parent {
  extra = 1;
}
export class GrandChild extends ChildNoCtor {}
export class ChildOwnCtor extends Parent {
  constructor(public b: B) {
    super(new A());
  }
}
export class ChildRest extends Parent {
  constructor(...args: any[]) {
    super(...(args as [A]));
  }
}
abstract class AbstractBase {
  constructor(public a: A) {}
}
export class Concrete extends AbstractBase {}

assertEqual(hasOwnDeps(ChildNoCtor), false, 'no own constructor -> no own entry');
assertEqual(getDeps(GrandChild)!.owner, Parent, 'grandchild walks two levels');
assertEqual(getDeps(ChildOwnCtor)!.owner, ChildOwnCtor, 'own constructor -> own entry');
assertEqual(getDeps(ChildOwnCtor)!.entry.slots.length, 1, 'own entry only lists own params');
assertEqual(hasOwnDeps(ChildRest), false, 'rest pass-through constructor treated as inherited');

const c = new Container();
const a = c.resolve<A>(A);
assertEqual(c.resolve<ChildNoCtor>(ChildNoCtor).a, a, 'child without ctor gets parent deps');
assertEqual(c.resolve<GrandChild>(GrandChild).a, a, 'grandchild gets parent deps');
const own = c.resolve<ChildOwnCtor>(ChildOwnCtor);
assertEqual(own.b instanceof B && own.a !== a, true, 'child with own ctor uses only its own deps');
assertEqual(c.resolve<ChildRest>(ChildRest).a, a, 'rest pass-through resolves via parent');
assertEqual(c.resolve<Concrete>(Concrete).a, a, 'abstract parent deps inherited');
