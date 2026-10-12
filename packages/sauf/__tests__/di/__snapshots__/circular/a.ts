import { __laratype_deps } from "virtual:laratype/di";
import { B, E } from './b.js';

export class C {}

export class A {
  constructor(public b: B) {}
}
__laratype_deps(A, [() => B], { params: ["b"] });

export class D {
  constructor(public e: E) {}
}
__laratype_deps(D, [() => E], { params: ["e"] });
