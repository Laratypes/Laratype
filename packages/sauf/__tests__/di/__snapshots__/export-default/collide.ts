import { __laratype_deps } from "virtual:laratype/di";
import { Dep } from './dep.js';

// User code that already declares the transform's internal name: the generated binding is aliased.
export class __laratype_default {
  readonly user = true;
}

export default class __laratype_default_1 {
  constructor(public dep: Dep) {}
}
__laratype_deps(__laratype_default_1, [() => Dep], { params: ["dep"] });
