import { describe, expect, it } from 'vitest'
import { Container, DiError, Inject, Injectable, __laratype_deps, depsRegistry, token } from '@laratype/core'

interface Mailer {
  send(to: string): string
}
const MAILER = token<Mailer>('Mailer')
const mailer: Mailer = { send: (to) => `sent:${to}` }

class Clock {}

const container = () => new Container({ deps: depsRegistry }).instance(MAILER, mailer)

describe('@Inject(token)', () => {
  it('resolves the token for a slot the transform saw (thunk agrees with the record)', () => {
    class Notifier {
      constructor(@Inject(MAILER) public mailer: Mailer, public clock: Clock) {}
    }
    __laratype_deps(Notifier, [() => MAILER, () => Clock], { params: ['mailer', 'clock'] })

    const n = container().make(Notifier)
    expect(n.mailer).toBe(mailer)
    expect(n.clock).toBeInstanceOf(Clock)
  })

  it('fills an unresolved slot from the runtime record (wrapper decorator the transform cannot see)', () => {
    const InjectMailer = () => Inject(MAILER)
    class Notifier {
      constructor(@InjectMailer() public mailer: Mailer) {}
    }
    __laratype_deps(Notifier, [{ unresolved: 'Mailer', index: 0 }], { params: ['mailer'] })

    expect(container().make(Notifier).mailer).toBe(mailer)
  })

  it('uses the record when the thunk returns undefined (interface imported as a value)', () => {
    class Notifier {
      constructor(@Inject(MAILER) public mailer: Mailer) {}
    }
    __laratype_deps(Notifier, [() => undefined], { params: ['mailer'] })

    expect(container().make(Notifier).mailer).toBe(mailer)
  })

  it('takes precedence over optional: an unbound token still throws', () => {
    const MISSING = token<string>('Missing')
    class Svc {
      constructor(@Inject(MISSING) public name?: string) {}
    }
    __laratype_deps(Svc, [{ unresolved: 'string', index: 0 }], { params: ['name'], optional: [0] })

    expect(() => container().make(Svc)).toThrow('No binding for InjectionToken(Missing).')
  })

  it('throws when the transform thunk and the record disagree', () => {
    const InjectMailer = () => Inject(MAILER)
    class ConsoleMailer implements Mailer {
      send(to: string) {
        return to
      }
    }
    class UsesWrapper {
      constructor(@InjectMailer() public mailer: ConsoleMailer) {}
    }
    __laratype_deps(UsesWrapper, [() => ConsoleMailer], { params: ['mailer'] })

    expect(() => container().make(UsesWrapper)).toThrow(DiError)
    expect(() => container().make(UsesWrapper)).toThrow(
      'Conflicting metadata for UsesWrapper constructor param #0 `mailer`: transform says ConsoleMailer, @Inject says InjectionToken(Mailer).',
    )
  })

  it('applies the records of the class that owns the constructor', () => {
    class Parent {
      constructor(@Inject(MAILER) public mailer: Mailer) {}
    }
    __laratype_deps(Parent, [{ unresolved: 'Mailer', index: 0 }], { params: ['mailer'] })
    class ChildNoCtor extends Parent {}
    class ChildOwnCtor extends Parent {
      constructor(public clock: Clock) {
        super(mailer)
      }
    }
    __laratype_deps(ChildOwnCtor, [() => Clock], { params: ['clock'] })

    expect(container().make(ChildNoCtor).mailer).toBe(mailer)
    expect(container().make(ChildOwnCtor).clock).toBeInstanceOf(Clock)
  })

  it('throws on a method parameter (method injection is #158)', () => {
    expect(() => {
      class Svc {
        run(@Inject(MAILER) _mailer: Mailer) {}
      }
      return Svc
    }).toThrow('@Inject() is only supported on constructor parameters (found on `run`).')
  })
})

describe('@Injectable({ scope })', () => {
  it('autowires a singleton once per container tree, built by the root', () => {
    @Injectable({ scope: 'singleton' })
    class Cache {
      constructor(public clock: Clock) {}
    }
    __laratype_deps(Cache, [() => Clock], { params: ['clock'] })

    const root = new Container({ deps: depsRegistry })
    const child = root.createChild()
    const overridden = new Clock()
    child.instance(Clock, overridden)

    const fromChild = child.make(Cache)
    expect(fromChild).toBe(root.make(Cache))
    expect(fromChild.clock).not.toBe(overridden)
    expect(root.has(Cache)).toBe(false)
    expect(new Container({ deps: depsRegistry }).make(Cache)).not.toBe(fromChild)
  })

  it('keeps autowired classes transient without a scope', () => {
    @Injectable()
    class Plain {}
    class Undecorated {}

    const c = new Container()
    expect(c.make(Plain)).not.toBe(c.make(Plain))
    expect(c.make(Undecorated)).not.toBe(c.make(Undecorated))
  })

  it('is the default scope of bind(), and an explicit scope wins', () => {
    @Injectable({ scope: 'singleton' })
    class Repo {}
    const REPO = token<Repo>('Repo')

    const c = new Container().bind(Repo).bind(REPO, Repo)
    expect(c.make(Repo)).toBe(c.make(Repo))
    expect(c.make(REPO)).toBe(c.make(REPO))

    const t = new Container().bind(Repo, undefined, { scope: 'transient' })
    expect(t.make(Repo)).not.toBe(t.make(Repo))
    const tr = new Container().transient(Repo)
    expect(tr.make(Repo)).not.toBe(tr.make(Repo))
  })

  it('makes a singleton class transient when the decorator says so', () => {
    @Injectable({ scope: 'transient' })
    class Fresh {}

    const c = new Container().bind(Fresh)
    expect(c.make(Fresh)).not.toBe(c.make(Fresh))
  })

  it('is not inherited by subclasses', () => {
    @Injectable({ scope: 'singleton' })
    class Base {}
    class Sub extends Base {}

    const c = new Container()
    expect(c.make(Base)).toBe(c.make(Base))
    expect(c.make(Sub)).not.toBe(c.make(Sub))
  })
})

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {}

describe('decorator types', () => {
  it('@Inject takes a token or a class, @Injectable a known scope', () => {
    typeOnly(() => {
      Inject(MAILER)
      Inject(Clock)
      // @ts-expect-error string keys are not tokens
      Inject('mailer')
      Injectable({ scope: 'singleton' })
      Injectable({ scope: 'request' })
      // @ts-expect-error unknown scope
      Injectable({ scope: 'session' })
    })
  })
})
