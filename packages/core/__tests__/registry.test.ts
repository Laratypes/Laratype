import { describe, expect, it } from 'vitest'
import { Container, DiError, __laratype_deps, depsRegistry, getDeps, hasOwnDeps, token } from '@laratype/core'

class A {}
class B {}

describe('__laratype_deps', () => {
  it('returns the class and stores the entry as a hidden own property', () => {
    class Svc {
      constructor(public a: A) {}
    }
    const slots = [() => A]
    const meta = { params: ['a'] }

    expect(__laratype_deps(Svc, slots, meta)).toBe(Svc)
    expect(hasOwnDeps(Svc)).toBe(true)
    expect(getDeps(Svc)).toEqual({ owner: Svc, entry: { slots, meta } })
    expect(Object.keys(Svc)).toEqual([])
    expect(Object.getOwnPropertySymbols(Svc)).toEqual([Symbol.for('laratype.di.deps')])
  })

  it('stores token thunks and unresolved markers as given (resolved lazily)', () => {
    const TOKEN = token<string>('t')
    let called = 0
    class Svc {}
    __laratype_deps(Svc, [() => (called++, TOKEN), { unresolved: 'Foo', index: 1 }], { params: ['t', 'foo'], optional: [1] })

    const entry = depsRegistry.get(Svc)!
    expect(called).toBe(0)
    expect((entry.slots[0] as () => unknown)()).toBe(TOKEN)
    expect(entry.slots[1]).toEqual({ unresolved: 'Foo', index: 1 })
    expect(entry.meta).toEqual({ params: ['t', 'foo'], optional: [1] })
  })

  it('accepts a call without meta', () => {
    class Svc {}
    __laratype_deps(Svc, [])
    expect(depsRegistry.get(Svc)).toEqual({ slots: [] })
  })

  it('lets the same class register again (HMR re-run)', () => {
    class Svc {}
    __laratype_deps(Svc, [() => A], { params: ['a'] })
    __laratype_deps(Svc, [() => B], { params: ['b'] })
    expect((depsRegistry.get(Svc)!.slots[0] as () => unknown)()).toBe(B)
  })
})

describe('inheritance', () => {
  class Parent {
    constructor(public a: A) {}
  }
  __laratype_deps(Parent, [() => A], { params: ['a'] })
  class ChildNoCtor extends Parent {}
  class GrandChild extends ChildNoCtor {}
  class ChildOwnCtor extends Parent {
    constructor(public b: B) {
      super(new A())
    }
  }
  __laratype_deps(ChildOwnCtor, [() => B], { params: ['b'] })
  class ZeroArgChild extends Parent {
    constructor() {
      super(new A())
    }
  }
  __laratype_deps(ZeroArgChild, [], { params: [] })

  it('a child without an own constructor inherits the nearest ancestor entry', () => {
    expect(hasOwnDeps(ChildNoCtor)).toBe(false)
    expect(getDeps(ChildNoCtor)!.owner).toBe(Parent)
    expect(getDeps(GrandChild)!.owner).toBe(Parent)
    expect(depsRegistry.get(GrandChild)).toBe(depsRegistry.get(Parent))
  })

  it('a child with an own constructor uses only its own entry', () => {
    expect(getDeps(ChildOwnCtor)!.owner).toBe(ChildOwnCtor)
    expect(depsRegistry.get(ChildOwnCtor)!.slots).toHaveLength(1)
    expect(depsRegistry.get(ZeroArgChild)).toEqual({ slots: [], meta: { params: [] } })
  })

  it('resolves through the D1 container', () => {
    const c = new Container({ deps: depsRegistry })
    expect(c.make(GrandChild).a).toBeInstanceOf(A)
    const own = c.make(ChildOwnCtor)
    expect(own.b).toBeInstanceOf(B)
    expect(c.make(ZeroArgChild)).toBeInstanceOf(ZeroArgChild)
  })

  it('has no entry for unregistered classes (no reflect-metadata loaded in this file)', () => {
    class Plain {
      constructor(public a: A) {}
    }
    expect(getDeps(Plain)).toBeUndefined()
    expect(getDeps(class {})).toBeUndefined()
    expect(() => new Container({ deps: depsRegistry }).make(Plain)).toThrow(DiError)
  })
})
