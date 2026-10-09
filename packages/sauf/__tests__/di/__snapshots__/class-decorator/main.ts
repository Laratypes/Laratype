import { __laratype_deps } from "virtual:laratype/di";
import { Container, Injectable, hasOwnDeps, assertEqual } from 'virtual:laratype/di';
import AnonDecorated from './anon.js';

class Dep {}

function Replace<T extends new (...args: any[]) => any>(target: T) {
  return class Replaced extends target {
    replaced = true;
  };
}

@Injectable()
export class Svc {
  constructor(public dep: Dep) {}
}
__laratype_deps(Svc, [() => Dep], { params: ["dep"] });

@Replace
export class Swapped {
  constructor(public dep: Dep) {}
}
__laratype_deps(Swapped, [() => Dep], { params: ["dep"] });

const c = new Container();
assertEqual(c.resolve<Svc>(Svc).dep instanceof Dep, true, '@Injectable() class');
assertEqual(Swapped.name, 'Replaced', 'decorator replaced the binding');
assertEqual(hasOwnDeps(Swapped), true, '__laratype_deps registered the FINAL (decorated) binding');
const s = c.resolve<any>(Swapped);
assertEqual(s.replaced === true && s.dep instanceof Dep, true, 'replaced class resolves with deps');
assertEqual(hasOwnDeps(AnonDecorated), true, 'decorated anonymous default class registered');
