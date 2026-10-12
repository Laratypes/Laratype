// Hand-written copy of what the DI transform (T1) emits, so the runtime registry is tested
// against the exact call shape. The import is aliased because this file declares its own
// `__laratype_deps` (T1's name-collision rule). `virtual:laratype/di` is mocked in the test.
import { __laratype_deps as __laratype_deps_1 } from 'virtual:laratype/di'
import { token } from '@laratype/core'

const __laratype_deps = (cls: unknown) => `user:${String(cls)}`
export const userHelper = __laratype_deps

export interface Mailer {
  send(): string
}
export const MAILER = token<Mailer>('mailer')

export class Config {}

export class Repo {
  constructor(public config: Config) {}
}
__laratype_deps_1(Repo, [() => Config], { params: ["config"] });

export class Service {
  constructor(public repo: Repo, public mailer: Mailer, public name?: string, public cache?: Repo | undefined) {}
}
__laratype_deps_1(Service, [() => Repo, () => MAILER, { unresolved: "string", index: 2 }, () => Repo], { params: ["repo", "mailer", "name", "cache"], optional: [2, 3] });

export class NeedsName {
  constructor(public repo: Repo, public name: string) {}
}
__laratype_deps_1(NeedsName, [() => Repo, { unresolved: "string", index: 1 }], { params: ["repo", "name"] });

// Inheritance: only classes with an own constructor get a call.
export class Parent {
  constructor(public repo: Repo) {}
}
__laratype_deps_1(Parent, [() => Repo], { params: ["repo"] });
export class ChildNoCtor extends Parent {
  extra = 1
}
export class GrandChild extends ChildNoCtor {}
export class ChildOwnCtor extends Parent {
  constructor(public config: Config) {
    super(new Repo(config))
  }
}
__laratype_deps_1(ChildOwnCtor, [() => Config], { params: ["config"] });

// Class expressions are wrapped, so the helper must return the class.
const bind = <T>(value: T) => value
export const Plain = bind(__laratype_deps_1(class {
  constructor(public repo: Repo) {}
}, [() => Repo], { params: ["repo"] }))
export const Keyed = __laratype_deps_1({ "Keyed": class {
  constructor(public repo: Repo) {}
} }["Keyed"], [() => Repo], { params: ["repo"] })
