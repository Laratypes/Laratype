import { __laratype_deps } from "virtual:laratype/di";
import { Dep } from './dep.js';

export default class __laratype_default {
  constructor(public dep: Dep) {}
}
__laratype_deps(__laratype_default, [() => Dep], { params: ["dep"] });
