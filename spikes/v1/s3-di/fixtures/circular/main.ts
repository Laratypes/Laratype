import { Container, assertEqual, assertThrows } from 'virtual:laratype/di';
import { A, C, D } from './a.js';

const c = new Container();
const a = c.resolve<A>(A);
assertEqual(a.b.c, c.resolve(C), 'module cycle a.ts <-> b.ts resolves (thunks are lazy)');
assertThrows(() => c.resolve(D), /Circular dependency: D -> E -> D/, 'instance cycle is reported');
