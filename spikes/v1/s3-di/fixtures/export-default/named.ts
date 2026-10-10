import { Dep } from './dep.js';

export default class Named {
  constructor(public dep: Dep) {}
}
