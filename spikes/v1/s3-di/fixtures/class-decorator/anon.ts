import { Injectable } from 'virtual:laratype/di';

export class Dep {}

@Injectable()
export default class {
  constructor(public dep: Dep) {}
}
