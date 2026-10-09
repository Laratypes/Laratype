import { __laratype_deps } from "virtual:laratype/di";
import { Dep } from './dep.js';

export default class Named {
  constructor(public dep: Dep) {}
}
__laratype_deps(Named, [() => Dep], { params: ["dep"] });
