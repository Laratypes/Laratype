import { __laratype_deps } from "virtual:laratype/di";
import { Injectable } from 'virtual:laratype/di';

export class Dep {}

@Injectable()
export default class __laratype_default {
  constructor(public dep: Dep) {}
}
__laratype_deps(__laratype_default, [() => Dep], { params: ["dep"] });
