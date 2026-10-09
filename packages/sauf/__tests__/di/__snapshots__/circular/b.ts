import { __laratype_deps } from "virtual:laratype/di";
import { C, D } from './a.js';

export class B {
  constructor(public c: C) {}
}
__laratype_deps(B, [() => C], { params: ["c"] });

export class E {
  constructor(public d: D) {}
}
__laratype_deps(E, [() => D], { params: ["d"] });
