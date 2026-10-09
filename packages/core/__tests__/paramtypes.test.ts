import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Container, DiError, __laratype_deps, depsRegistry, getDeps } from '@laratype/core'

// What TS/SWC `emitDecoratorMetadata` emits for a decorated class (esbuild in vitest doesn't, so set it by hand).
const paramTypes = (cls: Function, types: unknown[]) => Reflect.defineMetadata('design:paramtypes', types, cls)

class A {}
class B {}

describe('design:paramtypes fallback', () => {
  it('builds an entry from design:paramtypes when the class has no registration', () => {
    class ThirdParty {
      constructor(public a: A, public b: B) {}
    }
    paramTypes(ThirdParty, [A, B])

    const found = getDeps(ThirdParty)!
    expect(found.owner).toBe(ThirdParty)
    expect(found.entry.slots.map((s) => (s as () => unknown)())).toEqual([A, B])

    const made = new Container({ deps: depsRegistry }).make(ThirdParty)
    expect(made.a).toBeInstanceOf(A)
    expect(made.b).toBeInstanceOf(B)
  })

  it('marks interfaces, primitives and missing types as unresolved', () => {
    class Svc {
      constructor(public a: A, public i: object, public s: string, public n: number, public u: unknown) {}
    }
    paramTypes(Svc, [A, Object, String, Number, undefined])

    expect(getDeps(Svc)!.entry.slots.slice(1)).toEqual([
      { unresolved: 'Object', index: 1 },
      { unresolved: 'String', index: 2 },
      { unresolved: 'Number', index: 3 },
      { unresolved: 'undefined', index: 4 },
    ])
    expect(() => new Container({ deps: depsRegistry }).make(Svc)).toThrow('type `Object` has no runtime value')
  })

  it('prefers a __laratype_deps registration over design:paramtypes', () => {
    class Svc {
      constructor(public b: B) {}
    }
    paramTypes(Svc, [A])
    __laratype_deps(Svc, [() => B], { params: ['b'] })

    expect(new Container({ deps: depsRegistry }).make(Svc).b).toBeInstanceOf(B)
  })

  it('uses a child\'s own design:paramtypes instead of the parent\'s registration', () => {
    class Parent {
      constructor(public a: A) {}
    }
    __laratype_deps(Parent, [() => A], { params: ['a'] })
    class DecoratedChild extends Parent {
      constructor(public b: B) {
        super(new A())
      }
    }
    paramTypes(DecoratedChild, [B])
    class InheritingChild extends DecoratedChild {}

    expect(getDeps(DecoratedChild)!.owner).toBe(DecoratedChild)
    expect(getDeps(InheritingChild)!.owner).toBe(DecoratedChild)
    expect(new Container({ deps: depsRegistry }).make(InheritingChild).b).toBeInstanceOf(B)
  })

  it('walks past a parent\'s paramtypes only when the child has none of its own', () => {
    class Base {
      constructor(public a: A) {}
    }
    paramTypes(Base, [A])
    class Child extends Base {}

    expect(getDeps(Child)!.owner).toBe(Base)
    expect(new Container({ deps: depsRegistry }).make(Child).a).toBeInstanceOf(A)
  })

  it('still fails for a class with params and no metadata at all', () => {
    class Bare {
      constructor(public a: A) {}
    }
    expect(() => new Container({ deps: depsRegistry }).make(Bare)).toThrow(DiError)
  })
})
