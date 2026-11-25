import { afterEach, describe, expect, it, vi } from 'vitest'
import { appContainer, Container, DiError, Facade, peekAppContainer, token } from '@laratype/core'
import type { Token } from '@laratype/core'

abstract class Greeter {
  abstract greet(name: string): string
}

class Hello extends Greeter {
  greet(name: string) {
    return `hello ${name}`
  }
}

class Counter {
  count = 0
  next() {
    return ++this.count
  }
}

class Greet extends Facade {
  static override readonly accessor = Greeter
  static greet(name: string) {
    return this.root().greet(name)
  }
}

class Count extends Facade {
  static override readonly accessor = Counter
  static next() {
    return this.root().next()
  }
}

const NAME = token<{ value: string }>('name')

class Name extends Facade {
  static override readonly accessor = NAME
  static value() {
    return this.root().value
  }
}

const fake = (prefix: string): Greeter => ({ greet: name => `${prefix} ${name}` })

describe('Container.swap', () => {
  it('replaces a binding and restores it', () => {
    const c = new Container().bind(Greeter, Hello)
    const restore = c.swap(Greeter, fake('fake'))
    expect(c.make(Greeter).greet('Ada')).toBe('fake Ada')
    restore()
    expect(c.make(Greeter)).toBeInstanceOf(Hello)
  })

  it('restores a cached singleton as it was', () => {
    const c = new Container().singleton(Counter)
    const counter = c.make(Counter)
    const restore = c.swap(Counter, new Counter())
    expect(c.make(Counter)).not.toBe(counter)
    restore()
    expect(c.make(Counter)).toBe(counter)
  })

  it('removes the binding on restore when there was none, so the class autowires again', () => {
    const c = new Container()
    const restore = c.swap(Counter, Object.assign(new Counter(), { count: 41 }))
    expect(c.make(Counter).next()).toBe(42)
    restore()
    expect(c.has(Counter)).toBe(false)
    expect(c.make(Counter).next()).toBe(1)
  })

  it('shadows a parent binding for the container and its children, without touching the parent', () => {
    const parent = new Container().bind(Greeter, Hello)
    const child = parent.createChild()
    const restore = child.swap(Greeter, fake('child'))
    expect(child.createChild().make(Greeter).greet('Ada')).toBe('child Ada')
    expect(parent.make(Greeter)).toBeInstanceOf(Hello)
    restore()
    expect(child.make(Greeter)).toBeInstanceOf(Hello)
  })

  it('restore leaves a binding made after the swap in place', () => {
    const c = new Container()
    const restore = c.swap(Greeter, fake('fake'))
    c.bind(Greeter, Hello)
    restore()
    expect(c.make(Greeter)).toBeInstanceOf(Hello)
  })

  it('swaps a token', () => {
    const c = new Container().instance(NAME, { value: 'real' })
    const restore = c.swap(NAME, { value: 'fake' })
    expect(c.make(NAME).value).toBe('fake')
    restore()
    expect(c.make(NAME).value).toBe('real')
  })
})

describe('Facade', () => {
  afterEach(() => Facade.setFacadeApplication(undefined))

  it('reports whether a facade application is set', () => {
    expect(Facade.hasFacadeApplication()).toBe(false)
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(Facade.hasFacadeApplication()).toBe(true)
    Facade.setFacadeApplication(undefined)
    expect(Facade.hasFacadeApplication()).toBe(false)
  })

  it('forwards to the binding of its accessor in the facade application', () => {
    Facade.setFacadeApplication(new Container().bind(Greeter, Hello).instance(NAME, { value: 'app' }))
    expect(Greet.greet('Ada')).toBe('hello Ada')
    expect(Name.value()).toBe('app')
  })

  it('autowires a concrete accessor without a facade application', () => {
    expect(Count.next()).toBe(1)
    expect(Count.next()).toBe(1)
  })

  it('reuses a singleton binding across calls', () => {
    Facade.setFacadeApplication(new Container().singleton(Counter))
    expect(Count.next()).toBe(1)
    expect(Count.next()).toBe(2)
  })

  it('throws the container error when the accessor is not bound', () => {
    Facade.setFacadeApplication(new Container())
    expect(() => Name.value()).toThrow(DiError)
    expect(() => Name.value()).toThrow(/^No binding for InjectionToken\(name\)\./)
  })

  it('does not see a request scope from handler code: a scoped accessor throws', () => {
    class Scoped {
      make(value: string) { return `scoped:${value}` }
    }
    class ScopedFacade extends Facade {
      static override readonly accessor = Scoped
      static run(value: string) { return this.root().make(value) }
    }
    const app = new Container().scoped(Scoped)
    Facade.setFacadeApplication(app)
    app.createRequestScope()
    // Facades resolve from the app container, not the request scope: this is the documented limit (D12 #337)
    expect(() => ScopedFacade.run('x')).toThrow('Cannot resolve Scoped: it is request-scoped but no request scope is active.')
  })

  it('sees app.swap() at once, since it resolves on every call', () => {
    const app = new Container().bind(Greeter, Hello)
    Facade.setFacadeApplication(app)
    expect(Greet.greet('Ada')).toBe('hello Ada')
    const restore = app.swap(Greeter, fake('swapped'))
    expect(Greet.greet('Ada')).toBe('swapped Ada')
    restore()
    expect(Greet.greet('Ada')).toBe('hello Ada')
  })

  it('fake() swaps the binding in the facade application and restores it', () => {
    const app = new Container().bind(Greeter, Hello)
    Facade.setFacadeApplication(app)
    const restore = Greet.fake(fake('faked'))
    expect(Greet.greet('Ada')).toBe('faked Ada')
    expect(app.make(Greeter).greet('Ada')).toBe('faked Ada')
    restore()
    expect(Greet.greet('Ada')).toBe('hello Ada')
  })

  it('fake() works without a facade application', () => {
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    expect(Count.next()).toBe(10)
    restore()
    expect(Count.next()).toBe(1)
  })

  it('setFacadeApplication() drops the fallback container and its fakes', () => {
    const fallback = Facade.getFacadeApplication()
    Count.fake(Object.assign(new Counter(), { count: 9 }))
    Facade.setFacadeApplication(undefined)
    expect(Facade.getFacadeApplication()).not.toBe(fallback)
    expect(Count.next()).toBe(1)
  })

  it('throws on a facade without an accessor', () => {
    class Broken extends Facade {}
    expect(() => Broken.fake({})).toThrow('Facade Broken has no accessor.')
  })
})

describe('appContainer', () => {
  const FALLBACK_WARNED = Symbol.for('laratype.di.fallbackWarned')

  afterEach(() => {
    Facade.setFacadeApplication(undefined)
    delete (globalThis as { [FALLBACK_WARNED]?: true })[FALLBACK_WARNED]
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns the container set by setFacadeApplication(), and peek() never allocates a fallback', () => {
    expect(peekAppContainer()).toBeUndefined()
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(appContainer()).toBe(app)
    expect(peekAppContainer()).toBe(app)
    expect(Facade.getFacadeApplication()).toBe(app)
  })

  it('creates one shared fallback on first use and warns once in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('__PROD__', false)
    const fallback = appContainer()
    expect(fallback).toBeInstanceOf(Container)
    expect(peekAppContainer()).toBe(fallback)
    expect(appContainer()).toBe(fallback)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('No app container')
  })

  it('returns the stored fallback when the warning re-enters the lookup, so a fake made there applies', () => {
    vi.stubGlobal('__PROD__', false)
    let inner: Container | undefined
    let viaFacade: Container | undefined
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      inner = appContainer()
      viaFacade = Facade.getFacadeApplication()
      Count.fake(Object.assign(new Counter(), { count: 41 }))
    })
    const outer = appContainer()
    expect(inner).toBeDefined()
    expect(outer).toBe(inner)
    expect(viaFacade).toBe(outer)
    expect(peekAppContainer()).toBe(outer)
    expect(Count.next()).toBe(42)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('returns the app container a warning adapter set meanwhile, not the dropped fallback', () => {
    vi.stubGlobal('__PROD__', false)
    const app = new Container()
    vi.spyOn(console, 'warn').mockImplementation(() => {
      Facade.setFacadeApplication(app)
    })
    expect(appContainer()).toBe(app)
    expect(Facade.getFacadeApplication()).toBe(app)
    expect(peekAppContainer()).toBe(app)
  })

  it('does not warn in production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('__PROD__', true)
    appContainer()
    expect(warn).not.toHaveBeenCalled()
  })

  it('treats null and undefined as unset', () => {
    Facade.setFacadeApplication(new Container())
    expect(Facade.hasFacadeApplication()).toBe(true)
    Facade.setFacadeApplication(null as unknown as undefined)
    expect(Facade.hasFacadeApplication()).toBe(false)
    expect(peekAppContainer()).toBeUndefined()
    Facade.setFacadeApplication(undefined)
    expect(Facade.hasFacadeApplication()).toBe(false)
  })

  it('treats a falsy non-container number as unset and a truthy one as a failing application', () => {
    Facade.setFacadeApplication(0 as unknown as Container)
    expect(Facade.hasFacadeApplication()).toBe(false)
    Facade.setFacadeApplication(Number.NaN as unknown as Container)
    expect(Facade.hasFacadeApplication()).toBe(false)
    Facade.setFacadeApplication(1 as unknown as Container)
    expect(peekAppContainer()).toBe(1)
    expect(Facade.hasFacadeApplication()).toBe(true)
    expect(() => Count.fake(new Counter())).toThrow(TypeError)
    Facade.setFacadeApplication(Number.POSITIVE_INFINITY as unknown as Container)
    expect(peekAppContainer()).toBe(Number.POSITIVE_INFINITY)
    Facade.setFacadeApplication(undefined)
    expect(peekAppContainer()).toBeUndefined()
  })

  it('does not validate or read the container it is given: a wrong object fails on use, not on set', () => {
    const wrong = {} as Container
    Facade.setFacadeApplication(wrong)
    expect(peekAppContainer()).toBe(wrong)
    expect(Facade.hasFacadeApplication()).toBe(true)
    expect(() => Count.fake(new Counter())).toThrow(TypeError)
  })

  it('sets a proxy container without reading it, so a throwing get trap is never hit', () => {
    const proxy = new Proxy({}, { get: () => { throw new Error('the container was read') } }) as unknown as Container
    Facade.setFacadeApplication(proxy)
    expect(peekAppContainer()).toBe(proxy)
    expect(Facade.hasFacadeApplication()).toBe(true)
    expect(appContainer()).toBe(proxy)
  })

  it('keeps one app or one fallback across repeated set/clear calls', () => {
    vi.stubGlobal('__PROD__', true)
    const first = appContainer()
    Facade.setFacadeApplication(new Container())
    Facade.setFacadeApplication(undefined)
    expect(peekAppContainer()).toBeUndefined()
    const second = appContainer()
    expect(second).not.toBe(first)
    expect(appContainer()).toBe(second)
  })
})

describe('setFacadeApplication() dropped fakes', () => {
  const FALLBACK_WARNED = Symbol.for('laratype.di.fallbackWarned')
  const FAKES_DROPPED = Symbol.for('laratype.di.fakesDropped')

  afterEach(() => {
    Facade.setFacadeApplication(undefined)
    delete (globalThis as { [FALLBACK_WARNED]?: true })[FALLBACK_WARNED]
    delete (globalThis as { [FAKES_DROPPED]?: true })[FAKES_DROPPED]
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /** Create the fallback (and its D9 warning) before the counted calls, so only the dropped-fake warning is counted. */
  const warmFallback = (warn: ReturnType<typeof vi.spyOn>): void => {
    appContainer()
    warn.mockClear()
  }

  it('drops a pre-boot fake, warns once and names the token', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    Facade.setFacadeApplication(new Container())
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('Counter')
    expect(String(warn.mock.calls[0]![0])).toContain('Make the fake after the boot')
    // The fake lived in the dropped fallback: the app resolves its own binding
    expect(Count.next()).toBe(1)
    restore()
  })

  it('does not warn when every fake was restored before the app container is set', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    restore()
    Facade.setFacadeApplication(new Container())
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not warn in production', () => {
    vi.stubGlobal('__PROD__', true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    Count.fake(Object.assign(new Counter(), { count: 9 }))
    Facade.setFacadeApplication(new Container())
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns once per process for dropped fakes', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    Count.fake(Object.assign(new Counter(), { count: 9 }))
    Facade.setFacadeApplication(new Container())
    Facade.setFacadeApplication(undefined)
    Count.fake(Object.assign(new Counter(), { count: 19 }))
    Facade.setFacadeApplication(new Container())
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('names a fake still active after an inner one is restored', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    const outer = Count.fake(Object.assign(new Counter(), { count: 9 }))
    const inner = Count.fake(Object.assign(new Counter(), { count: 19 }))
    inner()
    Facade.setFacadeApplication(new Container())
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('Counter')
    outer()
  })

  it('a restore after the drop does not throw and changes nothing', () => {
    vi.stubGlobal('__PROD__', true)
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    const bound = new Counter()
    const app = new Container().instance(Counter, bound)
    Facade.setFacadeApplication(app)
    expect(Count.next()).toBe(1)
    expect(() => restore()).not.toThrow()
    // The dropped fallback's restore leaves the app container's binding alone
    expect(Count.next()).toBe(2)
  })

  it('does not read a proxy container that replaces a fallback with fakes', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    const proxy = new Proxy({}, { get: () => { throw new Error('the container was read') } }) as unknown as Container
    expect(() => Facade.setFacadeApplication(proxy)).not.toThrow()
    expect(peekAppContainer()).toBe(proxy)
    expect(warn).toHaveBeenCalledTimes(1)
    restore()
  })

  it('prints <anonymous class> when a class token name is not a string', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    class Tok {}
    // A `static name()` method (or any non-string name) is not the class name: print the placeholder, not its source.
    Object.defineProperty(Tok, 'name', { value: () => 'Tok' })
    class TokFacade extends Facade {
      static override readonly accessor = Tok
    }
    const restore = TokFacade.fake(new Tok())
    const app = new Container()
    expect(() => Facade.setFacadeApplication(app)).not.toThrow()
    expect(peekAppContainer()).toBe(app)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('unrestored fakes: <anonymous class>.')
    expect(String(warn.mock.calls[0]![0])).not.toContain('() =>')
    restore()
  })

  it('prints <anonymous class> for an empty, null, undefined, NaN or infinite name', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const name of ['', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      warmFallback(warn)
      class Tok {}
      Object.defineProperty(Tok, 'name', { value: name })
      class TokFacade extends Facade {
        static override readonly accessor = Tok
      }
      const restore = TokFacade.fake(new Tok())
      Facade.setFacadeApplication(new Container())
      expect(String(warn.mock.calls[0]![0])).toContain('unrestored fakes: <anonymous class>.')
      Facade.setFacadeApplication(undefined)
      restore()
      // The once flag is per process: clear it for the next label
      delete (globalThis as { [FAKES_DROPPED]?: true })[FAKES_DROPPED]
      warn.mockClear()
    }
  })

  it('escapes format and bidi characters in a token label and caps it at 100 characters', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    class Tok {}
    Object.defineProperty(Tok, 'name', { value: 'A\u202eB\u200eC\u200fD\u061cE\u0007F\\G' })
    class TokFacade extends Facade {
      static override readonly accessor = Tok
    }
    const restore = TokFacade.fake(new Tok())
    Facade.setFacadeApplication(new Container())
    const message = String(warn.mock.calls[0]![0])
    expect(message).toContain('A\\u202eB\\u200eC\\u200fD\\u061cE\\u0007F\\\\G')
    restore()

    // 200 characters after escaping are cut to 100 plus the ellipsis
    delete (globalThis as { [FAKES_DROPPED]?: true })[FAKES_DROPPED]
    Facade.setFacadeApplication(undefined)
    warn.mockClear()
    class Long {}
    Object.defineProperty(Long, 'name', { value: 'L'.repeat(200) })
    class LongFacade extends Facade {
      static override readonly accessor = Long
    }
    const restoreLong = LongFacade.fake(new Long())
    Facade.setFacadeApplication(new Container())
    expect(String(warn.mock.calls[0]![0])).toContain(`unrestored fakes: ${'L'.repeat(100)}…`)
    expect(String(warn.mock.calls[0]![0])).not.toContain('L'.repeat(101))
    restoreLong()
  })

  it('keeps a lone surrogate in a token label without throwing', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    class Tok {}
    Object.defineProperty(Tok, 'name', { value: 'Sur\uD800rogate' })
    class TokFacade extends Facade {
      static override readonly accessor = Tok
    }
    const restore = TokFacade.fake(new Tok())
    expect(() => Facade.setFacadeApplication(new Container())).not.toThrow()
    expect(String(warn.mock.calls[0]![0])).toContain('Sur\uD800rogate')
    restore()
  })

  it('names an InjectionToken fake the way the container does', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    const LABEL = token<object>('label')
    class LabelFacade extends Facade {
      static override readonly accessor = LABEL
    }
    const restore = LabelFacade.fake({})
    Facade.setFacadeApplication(new Container())
    expect(String(warn.mock.calls[0]![0])).toContain('unrestored fakes: InjectionToken(label).')
    restore()
  })

  it('sets the once flag after the warning prints, so a throwing warn does not silence the next drop', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    warn.mockImplementationOnce(() => { throw new Error('warn failed') })
    const first = Count.fake(Object.assign(new Counter(), { count: 9 }))
    expect(() => Facade.setFacadeApplication(new Container())).toThrow('warn failed')
    // The flag was not set by the failed warning: the next drop warns again
    Facade.setFacadeApplication(undefined)
    Count.fake(Object.assign(new Counter(), { count: 19 }))
    Facade.setFacadeApplication(new Container())
    expect(warn).toHaveBeenCalledTimes(2)
    first()
  })

  it('warns without throwing when a token cannot be printed', () => {
    vi.stubGlobal('__PROD__', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warmFallback(warn)
    const unprintable = { toString() { throw new Error('no label') } } as unknown as Token<object>
    class UnprintableFacade extends Facade {
      static override readonly accessor = unprintable
    }
    const restore = UnprintableFacade.fake({})
    const app = new Container()
    expect(() => Facade.setFacadeApplication(app)).not.toThrow()
    expect(peekAppContainer()).toBe(app)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('<unprintable token>')
    restore()
  })
})
