import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Container, DiError, Inject, Injectable, __laratype_deps, depsRegistry, token } from '@laratype/core'
import type { DepsEntry, DepsLookup } from '@laratype/core'

/** Resolution error messages with fix hints (D5a #100). */

// The dev hint is the default in this file; the production tests opt in with __PROD__.
beforeEach(() => {
  vi.stubGlobal('__PROD__', false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const MAILER = token<{ send(to: string): void }>('mailer')

class Clock {}

class Notifier {
  constructor(readonly mailer: unknown, readonly clock: Clock) {}
}

/** Test deps lookup in the S3 registry shape. */
const depsOf = (entries: [Function, DepsEntry][]) => new Map(entries)

const messageOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(DiError)
    return (error as DiError).message
  }
  throw new Error('expected a DiError')
}

describe('non-class keys', () => {
  it('reports a wrong-typed key without crashing', () => {
    for (const key of [null, undefined, 1, {}, { length: 1e9 }]) {
      expect(messageOf(() => new Container().make(key as never))).toContain('No binding for ')
    }
  })

  it('prints <unprintable key> when String(key) throws', () => {
    const key = {
      toString() {
        throw new Error('no string for you')
      },
    }
    expect(messageOf(() => new Container().make(key as never))).toContain('No binding for <unprintable key>.')
  })
})

describe('missing binding', () => {
  it('for a token resolved directly', () => {
    expect(messageOf(() => new Container().make(MAILER))).toMatchInlineSnapshot(`"No binding for InjectionToken(mailer). Fix: bind it in a service provider \`register()\`, e.g. \`container.bind(token, factory)\` or \`container.instance(token, value)\`."`)
  })

  it('for a token a constructor param needs', () => {
    const deps = depsOf([[Notifier, { slots: [() => MAILER, () => Clock], meta: { params: ['mailer', 'clock'] } }]])
    expect(messageOf(() => new Container({ deps }).make(Notifier))).toMatchInlineSnapshot(`"No binding for InjectionToken(mailer). Required by Notifier constructor param #0 \`mailer\`. Fix: bind it in a service provider \`register()\`, e.g. \`container.bind(token, factory)\` or \`container.instance(token, value)\`."`)
  })

  it('names the nearest requester in a nested graph', () => {
    class App {
      constructor(readonly notifier: Notifier) {}
    }
    const deps = depsOf([
      [App, { slots: [() => Notifier], meta: { params: ['notifier'] } }],
      [Notifier, { slots: [() => MAILER, () => Clock], meta: { params: ['mailer', 'clock'] } }],
    ])
    expect(messageOf(() => new Container({ deps }).make(App))).toMatchInlineSnapshot(`"No binding for InjectionToken(mailer). Required by Notifier constructor param #0 \`mailer\`. Fix: bind it in a service provider \`register()\`, e.g. \`container.bind(token, factory)\` or \`container.instance(token, value)\`."`)
  })

  it('for an optional param whose token is unbound', () => {
    const deps = depsOf([[Notifier, { slots: [() => MAILER, () => Clock], meta: { params: ['mailer', 'clock'], optional: [0] } }]])
    expect(messageOf(() => new Container({ deps }).make(Notifier))).toMatchInlineSnapshot(`"No binding for InjectionToken(mailer). Required by Notifier constructor param #0 \`mailer\`. Fix: bind it in a service provider \`register()\`, e.g. \`container.bind(token, factory)\` or \`container.instance(token, value)\`."`)
  })
})

describe('no dependency metadata', () => {
  it('for a named class', () => {
    expect(messageOf(() => new Container().make(Notifier))).toMatchInlineSnapshot(`"Cannot autowire Notifier: its constructor takes 2 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('for an anonymous class', () => {
    const Anonymous = (() => class {
      constructor(readonly mailer: unknown) {}
    })()
    expect(messageOf(() => new Container().make(Anonymous))).toMatchInlineSnapshot(`"Cannot autowire <anonymous class>: its constructor takes 1 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('for a class a constructor param needs', () => {
    class App {
      constructor(readonly notifier: Notifier) {}
    }
    const deps = depsOf([[App, { slots: [() => Notifier], meta: { params: ['notifier'] } }]])
    expect(messageOf(() => new Container({ deps }).make(App))).toMatchInlineSnapshot(`"Cannot autowire Notifier: its constructor takes 2 param(s) but no dependency metadata was found. Required by App constructor param #0 \`notifier\`. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('for a class a constructor param needs through a binding', () => {
    class NoMeta {
      constructor(readonly mailer: unknown) {}
    }
    class App {
      constructor(readonly noMeta: NoMeta) {}
    }
    const deps = depsOf([[App, { slots: [() => NoMeta], meta: { params: ['noMeta'] } }]])
    expect(messageOf(() => new Container({ deps }).bind(NoMeta).make(App))).toMatchInlineSnapshot(`"Cannot autowire NoMeta: its constructor takes 1 param(s) but no dependency metadata was found. Required by App constructor param #0 \`noMeta\`. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })
})

describe('no dependency metadata: more requesters', () => {
  it('for a class an @Inject record needs', () => {
    class NoMeta {
      constructor(readonly mailer: unknown) {}
    }
    class App {
      constructor(@Inject(NoMeta) readonly noMeta: unknown) {}
    }
    __laratype_deps(App, [{ unresolved: 'NoMeta', index: 0 }], { params: ['noMeta'] })
    expect(messageOf(() => new Container({ deps: depsRegistry }).make(App))).toMatchInlineSnapshot(`"Cannot autowire NoMeta: its constructor takes 1 param(s) but no dependency metadata was found. Required by App constructor param #0 \`noMeta\`. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('for a singleton a constructor param needs', () => {
    @Injectable({ scope: 'singleton' })
    class NoMeta {
      constructor(readonly mailer: unknown) {}
    }
    class App {
      constructor(readonly noMeta: NoMeta) {}
    }
    __laratype_deps(App, [() => NoMeta], { params: ['noMeta'] })
    expect(messageOf(() => new Container({ deps: depsRegistry }).make(App))).toMatchInlineSnapshot(`"Cannot autowire NoMeta: its constructor takes 1 param(s) but no dependency metadata was found. Required by App constructor param #0 \`noMeta\`. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('for a request-scoped class a constructor param needs', () => {
    @Injectable({ scope: 'request' })
    class NoMeta {
      constructor(readonly mailer: unknown) {}
    }
    class App {
      constructor(readonly noMeta: NoMeta) {}
    }
    __laratype_deps(App, [() => NoMeta], { params: ['noMeta'] })
    expect(messageOf(() => new Container({ deps: depsRegistry }).createRequestScope().make(App))).toMatchInlineSnapshot(`"Cannot autowire NoMeta: its constructor takes 1 param(s) but no dependency metadata was found. Required by App constructor param #0 \`noMeta\`. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })
})

describe('no dependency metadata: hint wording', () => {
  it('in production names the factory, not the plugin', () => {
    vi.stubGlobal('__PROD__', true)
    expect(messageOf(() => new Container().make(Notifier))).toMatchInlineSnapshot(`"Cannot autowire Notifier: its constructor takes 2 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container; a production \`sauf build\` does not run the laratype:di plugin yet, so it cannot add the metadata."`)
  })

  it('in production via NODE_ENV when __PROD__ is unset', () => {
    vi.stubGlobal('__PROD__', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    expect(messageOf(() => new Container().make(Notifier))).toMatchInlineSnapshot(`"Cannot autowire Notifier: its constructor takes 2 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container; a production \`sauf build\` does not run the laratype:di plugin yet, so it cannot add the metadata."`)
  })

  it('in dev names the factory first and keeps the plugin hint for app code', () => {
    vi.stubGlobal('__PROD__', false)
    expect(messageOf(() => new Container().make(Notifier))).toMatchInlineSnapshot(`"Cannot autowire Notifier: its constructor takes 2 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('names the factory as the only fix for a third-party class', () => {
    class Redis {
      constructor(readonly url: string) {}
    }
    const message = messageOf(() => new Container().make(Redis))
    // Core cannot tell where a class comes from, so dev has one wording for both; it must read factory-first.
    expect(message).toContain('the only fix for a class outside the app, such as a third-party class')
    expect(message.indexOf('bind it with a factory')).toBeLessThan(message.indexOf('laratype:di'))
    expect(message).toMatchInlineSnapshot(`"Cannot autowire Redis: its constructor takes 1 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('an explicit __PROD__ = false wins over NODE_ENV=production', () => {
    vi.stubGlobal('__PROD__', false)
    vi.stubEnv('NODE_ENV', 'production')
    expect(messageOf(() => new Container().make(Notifier))).toContain('for app code, the laratype:di plugin')
  })
})

describe('no dependency metadata: hostile class names', () => {
  const namedClass = (name: string) => {
    const cls = class {
      constructor(readonly dep: unknown) {}
    }
    Object.defineProperty(cls, 'name', { value: name })
    return cls
  }

  it('falls back when the name getter throws', () => {
    const Throwing = namedClass('Ignored')
    Object.defineProperty(Throwing, 'name', {
      get() {
        throw new Error('no name for you')
      },
    })
    expect(messageOf(() => new Container().make(Throwing))).toMatchInlineSnapshot(`"Cannot autowire <anonymous class>: its constructor takes 1 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('does not print a non-string name (a static name() method, an object or a number) as the class name', () => {
    for (const value of [() => 'Tok', 42, {}, Symbol('Tok')]) {
      const Tok = namedClass('Ignored')
      Object.defineProperty(Tok, 'name', { value })
      const message = messageOf(() => new Container().make(Tok))
      expect(message).toContain('Cannot autowire <anonymous class>:')
      expect(message).not.toContain('() =>')
      expect(message).not.toContain('[object Object]')
    }
  })

  it('prints <anonymous class> for a non-string name in the requester label (paramLabel)', () => {
    const Requester = namedClass('Ignored')
    Object.defineProperty(Requester, 'name', { value: () => 'Requester' })
    class NoMeta {
      constructor(readonly dep: unknown) {}
    }
    const deps = depsOf([[Requester, { slots: [() => NoMeta], meta: { params: ['dep'] } }]])
    const message = messageOf(() => new Container({ deps }).make(Requester))
    expect(message).toContain('Required by <anonymous class> constructor param #0 `dep`.')
    expect(message).not.toContain('() =>')
  })

  it('keeps a 100k class name', () => {
    const name = 'L'.repeat(100_000)
    const message = messageOf(() => new Container().make(namedClass(name)))
    expect(message).toContain(`Cannot autowire ${name}: its constructor takes 1 param(s)`)
    expect(message.length).toBeGreaterThan(100_000)
  })

  it('escapes control and format characters, line separators and backslashes onto one line', () => {
    const name = 'Ctl\nName\r\u0000\u001b\u009b\u2028\u202e\u200e\u200f\u061c\u{E0001}\\'
    const message = messageOf(() => new Container().make(namedClass(name)))
    // U+E0001 is a supplementary Cf character: its UTF-16 surrogate pair must both be escaped.
    expect(message).toContain('Cannot autowire Ctl\\u000aName\\u000d\\u0000\\u001b\\u009b\\u2028\\u202e\\u200e\\u200f\\u061c\\udb40\\udc01\\\\: its constructor')
    expect(message).not.toContain('\n')
  })

  it('keeps a lone surrogate in the name without throwing', () => {
    const name = 'Sur\uD800rogate'
    // A lone surrogate is not a control character; it stays in the name and must not throw.
    expect(messageOf(() => new Container().make(namedClass(name)))).toContain(`Cannot autowire ${name}:`)
  })

  it('reads a proxied class name', () => {
    const Proxied = new Proxy(namedClass('Redis'), {})
    // A proxy with no traps forwards `name`; the wrapped class is Redis.
    expect(messageOf(() => new Container().make(Proxied))).toMatchInlineSnapshot(`"Cannot autowire Redis: its constructor takes 1 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('falls back when a proxy throws for name', () => {
    const Proxied = new Proxy(namedClass('Redis'), {
      get(target, property, receiver) {
        if (property === 'name') throw new Error('no name for you')
        return Reflect.get(target, property, receiver)
      },
    })
    expect(messageOf(() => new Container().make(Proxied))).toMatchInlineSnapshot(`"Cannot autowire <anonymous class>: its constructor takes 1 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('names the nearest requester in a 1000-level chain', () => {
    const deps = new Map<Function, DepsEntry>()
    let next: new (dep: unknown) => unknown = class Leaf {
      constructor(readonly dep: unknown) {}
    }
    for (let level = 0; level < 1000; level++) {
      const Dep = next
      const cls = class {
        constructor(readonly dep: unknown) {
          void Dep
        }
      }
      Object.defineProperty(cls, 'name', { value: `Level${level}` })
      deps.set(cls, { slots: [() => Dep], meta: { params: ['dep'] } })
      next = cls
    }
    // Level0 is the class that directly requires Leaf; the 999 levels above it only deepen the stack.
    expect(messageOf(() => new Container({ deps }).make(next))).toMatchInlineSnapshot(`"Cannot autowire Leaf: its constructor takes 1 param(s) but no dependency metadata was found. Required by Level0 constructor param #0 \`dep\`. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })
})

describe('zero-length constructors', () => {
  class Clock {}

  it('fails when every param has a default and the constructor leads the class', () => {
    class Defaults {
      constructor(readonly clock: Clock = new Clock()) {}
    }
    expect(messageOf(() => new Container().make(Defaults))).toMatchInlineSnapshot(`"Cannot autowire Defaults: its constructor takes 1 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('counts the params before a rest param', () => {
    class Defaults {
      constructor(readonly clock: Clock = new Clock(), readonly retries = 3, ...rest: unknown[]) {
        void rest
      }
    }
    expect(messageOf(() => new Container().make(Defaults))).toMatchInlineSnapshot(`"Cannot autowire Defaults: its constructor takes 2 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('reads the full param count when only a later param has a default', () => {
    class PartlyDefaulted {
      constructor(readonly clock: Clock, readonly retries = 3) {}
    }
    // cls.length is 1 here, so the count has to come from the source too.
    expect(messageOf(() => new Container().make(PartlyDefaulted))).toMatchInlineSnapshot(`"Cannot autowire PartlyDefaulted: its constructor takes 2 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  const sourceClass = (defaultSource: string) =>
    new Function(`return class RegexDefault { constructor(pattern = ${defaultSource}, extra = 1) { this.pattern = pattern; this.extra = extra } }`)() as new () => { pattern: unknown, extra: unknown }

  it.each([
    ['a comma', '/,/'],
    ['brackets', '/[(]/'],
    ['a quote', `/["']/`],
    ['an escaped slash', '/a\\/b/'],
    ['a division', '4 / 2'],
    ['a division after a string with slashes', '"a//b" / 2'],
    ['a division after a property keyword', 'obj.return / 2'],
    ['a throw keyword', '() => { throw /,/ }'],
  ])('counts both params when a default has %s', (_, defaultSource) => {
    expect(messageOf(() => new Container().make(sourceClass(defaultSource)))).toContain('takes 2 param(s)')
  })

  it.each(['of', 'as', 'get', 'set', 'async', 'from', 'type'])('reads %s as a parameter name', (name) => {
    const cls = new Function(`return class Contextual { constructor(${name} = 1, extra = 2) {} }`)() as new () => unknown
    expect(messageOf(() => new Container().make(cls))).toContain('takes 2 param(s)')
  })

  it.each(['as', 'get', 'set', 'async', 'from', 'type'])('reads %s as a parameter name with a division default', (name) => {
    const cls = new Function(`return class ContextualDivision { constructor(${name} = 1, extra = ${name} / 2) {} }`)() as new () => unknown
    expect(messageOf(() => new Container().make(cls))).toContain('takes 2 param(s)')
  })

  it.each([
    ['a default', 'KnownDefault { constructor(f = of / 2, extra = 1) {} }'],
    ['a parameter name', 'KnownName { constructor(of = 1, extra = of / 2) {} }'],
    ['a call argument', 'KnownCall { constructor(f = f(of / 2), extra = 1) {} }'],
    ['a return', 'KnownReturn { constructor(f = () => { return of / 2 }, extra = 1) {} }'],
    ['a comparison', 'KnownCompare { constructor(f = () => { for (let i = 0; i < of / 2; i++) {} }, extra = 1) {} }'],
    ['a property for call', 'KnownProperty { constructor(f = q.for(of / 2), extra = 1) {} }'],
  ])('reads of before a slash as a keyword (known limit: %s)', (_, body) => {
    const cls = new Function(`return class ${body}`)() as new () => unknown
    expect(messageOf(() => new Container().make(cls))).toContain('takes 1 param(s)')
  })

  it.each([
    ['a destructured LHS with a call default', 'Destructured { constructor(f = () => { for (const {a = g()} of /\\)/) {} }, extra = 1) {} }', 2],
    ['an array LHS with a grouped default', 'ArrayLhs { constructor(f = () => { for (const [a = (1)] of /\\)/) {} }, extra = 1) {} }', 2],
    ['a block comment before the header', 'BlockComment { constructor(f = () => { for /*c*/ (const x of /\\)/) {} }, extra = 1) {} }', 2],
    ['a string containing "for ("', 'StringFor { constructor(a = "for (", f = () => { for (const x of /\\)/) {} }, b = 1) {} }', 3],
    ['an earlier for-of', 'EarlierForOf { constructor(f = () => { for (const x of xs) {} }, extra = 1) {} }', 2],
    ['const of of', 'ConstOfOf { constructor(f = () => { for (const of of /\\)/) {} }, extra = 1) {} }', 2],
    ['a URL string before a for-of', 'UrlBefore { constructor(u = "http://x", f = () => { for (const x of /\\)/) {} }, extra = 1) {} }', 3],
    ['a real for...of keyword', 'RealForOf { constructor(f = () => { for (const x of /\\)/) {} }, extra = 1) {} }', 2],
    ['a real for await keyword', 'AwaitForOf { constructor(f = async () => { for await (const x of /\\)/) {} }, extra = 1) {} }', 2],
  ])('counts the params when a for header has %s', (_, body, count) => {
    const cls = new Function(`return class ${body}`)() as new () => unknown
    expect(messageOf(() => new Container().make(cls))).toContain(`takes ${count} param(s)`)
  })

  it('counts await as a keyword in a parameter name (known limit)', () => {
    const cls = new Function('return class AwaitName { constructor(await = 1, b = await / 2) {} }')() as new () => unknown
    expect(messageOf(() => new Container().make(cls))).toContain('takes 1 param(s)')
  })

  it('treats a postfix increment before a slash as a division', () => {
    const postfix = new Function('a', 'b', 'return class Postfix { constructor(value = a++ / b, extra = 1) { this.value = value; this.extra = extra } }')(1, 1) as new () => { value: unknown, extra: unknown }
    expect(messageOf(() => new Container().make(postfix))).toContain('takes 2 param(s)')
  })

  it('reports one param instead of failing open when the source cannot be parsed', () => {
    class Broken {
      constructor(value = 1) {
        void value
      }
    }
    const original = Function.prototype.toString
    const toString = vi.spyOn(Function.prototype, 'toString').mockImplementation(function (this: Function) {
      return this === Broken ? 'class Broken { constructor(value = /' : original.call(this)
    })
    try {
      expect(messageOf(() => new Container().make(Broken))).toContain('takes 1 param(s)')
    } finally {
      toString.mockRestore()
    }
  })

  it('keeps cls.length as a lower bound when the scan cannot parse the list', () => {
    class Truncated {
      constructor(first: Clock, second: Clock) {
        void first
        void second
      }
    }
    const original = Function.prototype.toString
    const toString = vi.spyOn(Function.prototype, 'toString').mockImplementation(function (this: Function) {
      return this === Truncated ? 'class Truncated { constructor(first, second' : original.call(this)
    })
    try {
      // The reader reports one param for the unparseable list; cls.length says the engine saw two
      expect(messageOf(() => new Container().make(Truncated))).toContain('takes 2 param(s)')
    } finally {
      toString.mockRestore()
    }
  })

  it('fails closed when a line comment ends at U+2028 before a real param', () => {
    const before = new Function('return class LineComment {\u002F\u002F c\u2028 constructor(dep = 1) { this.dep = dep } }')() as new () => { dep: unknown }
    const inline = new Function('return class InlineComment { constructor(\u002F\u002F c\u2028 dep = 1) { this.dep = dep } }')() as new () => { dep: unknown }
    expect(messageOf(() => new Container().make(before))).toContain('takes 1 param(s)')
    expect(messageOf(() => new Container().make(inline))).toContain('takes 1 param(s)')
  })

  it('skips JS whitespace, NBSP included, before the constructor', () => {
    const nbsp = new Function('return class Nbsp {\u00a0constructor(dep = 1) { this.dep = dep } }')() as new () => { dep: unknown }
    expect(messageOf(() => new Container().make(nbsp))).toContain('takes 1 param(s)')
  })

  it('builds a rest-only constructor with no args', () => {
    class Rest {
      deps: unknown[]
      constructor(...deps: unknown[]) {
        this.deps = deps
      }
    }
    expect(new Container().make(Rest).deps).toEqual([])
  })

  it('builds a no-arg constructor whose list has a comment', () => {
    class Commented {
      constructor(/* no deps */) {}
    }
    expect(new Container().make(Commented)).toBeInstanceOf(Commented)
  })

  it('trusts an own empty entry for a no-arg constructor', () => {
    class Empty {
      constructor() {}
    }
    __laratype_deps(Empty, [], { params: [] })
    expect(new Container({ deps: depsRegistry }).make(Empty)).toBeInstanceOf(Empty)
  })

  it('reads the outer constructor when the heritage has an object literal', () => {
    class Base {
      constructor() {}
    }
    const mixin = (_options: unknown) => Base
    const Extended = new Function('Base', 'mixin', `return class Extended extends mixin({ constructor() {} }) {
      constructor(port = 5432) { super(); this.port = port }
    }`)(Base, mixin) as new () => { port: unknown }
    // The object literal's constructor is not the class body; the outer constructor has one defaulted param.
    expect(messageOf(() => new Container().make(Extended))).toContain('takes 1 param(s)')
  })

  it('skips a heritage class expression and reads the subclass constructor', () => {
    const B = new Function('return class B extends class { constructor() {} } { constructor(dep) { super(); this.dep = dep } }')()
    const C = new Function('return class C extends class { m() {} } { constructor(dep = 1) { super(); this.dep = dep } }')()
    const Nested = new Function(
      'return class Nested extends class extends class { m() {} } { constructor(x = 1) {} } { constructor(dep = 1) { super(); this.dep = dep } }',
    )()
    // B's required param is in its own body, after the parent class expression; the parent's `constructor()` must not report 0
    expect(messageOf(() => new Container().make(B))).toContain('Cannot autowire B: its constructor takes 1 param(s)')
    // C's leading constructor is after the parent class expression, so the all-default rule applies to it
    expect(messageOf(() => new Container().make(C))).toContain('Cannot autowire C: its constructor takes 1 param(s)')
    expect(messageOf(() => new Container().make(Nested))).toContain('Cannot autowire Nested: its constructor takes 1 param(s)')
  })

  it.each([
    ['a required param', 'constructor(dep) { this.dep = dep }'],
    ['a defaulted param', 'constructor(dep = 1) { this.dep = dep }'],
  ])('counts an inline parent constructor with %s when the subclass has none', (_, constructor) => {
    // The implicit `super(...args)` passes nothing, so the parent's params would be undefined (or defaulted) silently
    const cls = new Function(`return class Inline extends class { ${constructor} } {}`)()
    expect(messageOf(() => new Container().make(cls))).toContain('Cannot autowire Inline: its constructor takes 1 param(s)')
  })

  it('counts an inline parent constructor through its own inline parent', () => {
    const cls = new Function(
      'return class Deep extends class extends class { constructor(dep) { this.dep = dep } } {} {}',
    )()
    expect(messageOf(() => new Container().make(cls))).toContain('Cannot autowire Deep: its constructor takes 1 param(s)')
  })

  it('does not read a class keyword from a member, private or unicode identifier name', () => {
    const Éclass = new Function('return class Éclass { constructor(dep = 1) { this.dep = dep } }')() as new () => { dep: unknown }
    const classÉ = new Function('return class classÉ { constructor(dep = 1) { this.dep = dep } }')() as new () => { dep: unknown }
    const UnicodeHeritage = new Function('Éclass', 'return class UnicodeHeritage extends Éclass { constructor(dep = 1) { super(); this.dep = dep } }')(Éclass)
    const member = { class: Éclass }
    const MemberHeritage = new Function('obj', 'return class MemberHeritage extends obj. class { constructor(dep = 1) { super(); this.dep = dep } }')(member)
    const Host = new Function(`return class Host {
      #class = class { constructor() {} }
      create() { return class PrivateHeritage extends this.#class { constructor(dep = 1) { super(); this.dep = dep } } }
    }`)()
    const PrivateHeritage = new Host().create()
    const BodyField = new Function('obj', 'return class BodyField extends class { value = obj. class; #class = 1 } { constructor(dep = 1) { super(); this.dep = dep } }')(member)
    // Each source hides `class` behind a unicode identifier, a property name, a private name or a parent body field
    for (const [name, cls] of [['Éclass', Éclass], ['classÉ', classÉ], ['UnicodeHeritage', UnicodeHeritage], ['MemberHeritage', MemberHeritage], ['PrivateHeritage', PrivateHeritage], ['BodyField', BodyField]] as const) {
      expect(messageOf(() => new Container().make(cls))).toContain(`Cannot autowire ${name}: its constructor takes 1 param(s)`)
    }
  })

  it('does not see a constructor after a field (known limit)', () => {
    // `new Function` keeps the field in the source; a transformer moves it into the constructor instead.
    const FieldFirst = new Function('Clock', `return class FieldFirst {
      clock = new Clock()
      constructor(dep = new Clock()) { this.dep = dep }
    }`)(Clock) as new () => { clock: Clock, dep: Clock }
    const value = new Container().make(FieldFirst)
    expect(value.clock).toBeInstanceOf(Clock)
    expect(value.dep).toBeInstanceOf(Clock)
  })

  it('fails an inherited entry with no slots instead of building it with no args', () => {
    class Base {
      constructor() {}
    }
    __laratype_deps(Base, [], { params: [] })
    class Sub extends Base {
      constructor(readonly clock: Clock = new Clock()) {
        super()
      }
    }
    expect(messageOf(() => new Container({ deps: depsRegistry }).make(Sub))).toMatchInlineSnapshot(`"Cannot autowire Sub: its constructor takes 1 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })

  it('still applies an inherited entry with slots to an all-default constructor (known limit)', () => {
    class Base {
      constructor(readonly clock: Clock) {}
    }
    __laratype_deps(Base, [() => Clock], { params: ['clock'] })
    class Sub extends Base {
      constructor(readonly clock: Clock = new Clock()) {
        super(clock)
      }
    }
    // Sub.length is 0, so the registry applies Base's one-slot entry and passes the clock positionally.
    expect(new Container({ deps: depsRegistry }).make(Sub).clock).toBeInstanceOf(Clock)
  })
})

describe('custom deps lookups', () => {
  class Cfg {
    constructor(readonly port = 5432) {}
  }
  const entry: DepsEntry = { slots: [] }

  it('trusts an entry from a lookup that has no ownership signal', () => {
    const deps: DepsLookup = { get: (cls) => (cls === Cfg ? entry : undefined) }
    expect(new Container({ deps }).make(Cfg).port).toBe(5432)
  })

  it('trusts an entry the lookup reports as own', () => {
    const deps: DepsLookup = { get: (cls) => (cls === Cfg ? entry : undefined), hasOwn: () => true }
    expect(new Container({ deps }).make(Cfg).port).toBe(5432)
  })

  it('fails an all-default constructor when the lookup reports the entry inherited', () => {
    const deps: DepsLookup = { get: (cls) => (cls === Cfg ? entry : undefined), hasOwn: () => false }
    expect(messageOf(() => new Container({ deps }).make(Cfg))).toMatchInlineSnapshot(`"Cannot autowire Cfg: its constructor takes 1 param(s) but no dependency metadata was found. Fix: bind it with a factory in a service provider \`register()\` of the app container (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under \`sauf dev\`."`)
  })
})

describe('unresolved param', () => {
  it('with a param name', () => {
    class Greeter {
      constructor(readonly clock: Clock, readonly name: string) {}
    }
    const deps = depsOf([[Greeter, { slots: [() => Clock, { unresolved: 'string', index: 1 }], meta: { params: ['clock', 'name'] } }]])
    expect(messageOf(() => new Container({ deps }).make(Greeter))).toMatchInlineSnapshot(`"Cannot resolve Greeter constructor param #1 \`name\`: type \`string\` has no runtime value. Fix: add @Inject(token) to the parameter, or import the class as a value (not \`import type\`)."`)
  })

  it('without a param name (design:paramtypes fallback)', () => {
    class Legacy {
      constructor(readonly mailer: unknown) {}
    }
    const deps = depsOf([[Legacy, { slots: [{ unresolved: 'Object', index: 0 }], meta: { params: [] } }]])
    expect(messageOf(() => new Container({ deps }).make(Legacy))).toMatchInlineSnapshot(`"Cannot resolve Legacy constructor param #0: type \`Object\` has no runtime value. Fix: add @Inject(token) to the parameter, or import the class as a value (not \`import type\`)."`)
  })

  it('in an anonymous class', () => {
    const Anonymous = (() => class {
      constructor(readonly mailer: unknown) {}
    })()
    const deps = depsOf([[Anonymous, { slots: [{ unresolved: 'Mailer', index: 0 }], meta: { params: ['mailer'] } }]])
    expect(messageOf(() => new Container({ deps }).make(Anonymous))).toMatchInlineSnapshot(`"Cannot resolve <anonymous class> constructor param #0 \`mailer\`: type \`Mailer\` has no runtime value. Fix: add @Inject(token) to the parameter, or import the class as a value (not \`import type\`)."`)
  })
})

describe('thunk returning undefined', () => {
  it('with a param name', () => {
    const deps = depsOf([[Notifier, { slots: [() => undefined, () => Clock], meta: { params: ['mailer', 'clock'] } }]])
    expect(messageOf(() => new Container({ deps }).make(Notifier))).toMatchInlineSnapshot(`"Cannot resolve Notifier constructor param #0 \`mailer\`: its type resolved to undefined at runtime. It is probably an interface/type imported without \`import type\`, or a circular import evaluated too early. Fix: use \`import type\` + @Inject(token), or import the class as a value."`)
  })

  it('without metadata', () => {
    const deps = depsOf([[Notifier, { slots: [() => Clock, () => undefined] }]])
    expect(messageOf(() => new Container({ deps }).make(Notifier))).toMatchInlineSnapshot(`"Cannot resolve Notifier constructor param #1: its type resolved to undefined at runtime. It is probably an interface/type imported without \`import type\`, or a circular import evaluated too early. Fix: use \`import type\` + @Inject(token), or import the class as a value."`)
  })
})

describe('@Inject records (D3)', () => {
  it('for a record token that is unbound', () => {
    const InjectMailer = () => Inject(MAILER)
    class Digest {
      constructor(@InjectMailer() readonly mailer: unknown) {}
    }
    __laratype_deps(Digest, [{ unresolved: 'Mailer', index: 0 }], { params: ['mailer'] })
    expect(messageOf(() => new Container({ deps: depsRegistry }).make(Digest))).toMatchInlineSnapshot(`"No binding for InjectionToken(mailer). Required by Digest constructor param #0 \`mailer\`. Fix: bind it in a service provider \`register()\`, e.g. \`container.bind(token, factory)\` or \`container.instance(token, value)\`."`)
  })

  it('for a transform thunk that disagrees with the record', () => {
    const InjectMailer = () => Inject(MAILER)
    class ConsoleMailer {}
    class UsesWrapper {
      constructor(@InjectMailer() readonly mailer: ConsoleMailer) {}
    }
    __laratype_deps(UsesWrapper, [() => ConsoleMailer], { params: ['mailer'] })
    expect(messageOf(() => new Container({ deps: depsRegistry }).make(UsesWrapper))).toMatchInlineSnapshot(`"Conflicting metadata for UsesWrapper constructor param #0 \`mailer\`: transform says ConsoleMailer, @Inject says InjectionToken(mailer). Fix: use @Inject from @laratype/core directly (aliases/wrappers are invisible to the build transform)."`)
  })
})

describe('abstract class without a binding', () => {
  abstract class Port {
    constructor(readonly clock: Clock) {}
  }
  __laratype_deps(Port, [() => Clock], { params: ['clock'], abstract: true })
  // No own constructor: flag-only call, the deps stay inherited from Port.
  abstract class Mid extends Port {}
  __laratype_deps(Mid, null, { params: [], abstract: true })
  class SmtpPort extends Mid {}

  const container = () => new Container({ deps: depsRegistry })

  it('resolved directly', () => {
    expect(messageOf(() => container().make(Port))).toMatchInlineSnapshot(`"No binding for abstract class Port. Fix: bind it to a concrete class in a service provider \`register()\`, e.g. \`container.bind(Port, Impl)\`."`)
  })

  it('flagged through a flag-only call (null slots)', () => {
    expect(messageOf(() => container().make(Mid))).toMatchInlineSnapshot(`"No binding for abstract class Mid. Fix: bind it to a concrete class in a service provider \`register()\`, e.g. \`container.bind(Mid, Impl)\`."`)
  })

  it('needed by a constructor param', () => {
    class Service {
      constructor(readonly port: Mid) {}
    }
    __laratype_deps(Service, [() => Mid], { params: ['port'] })
    expect(messageOf(() => container().make(Service))).toMatchInlineSnapshot(`"No binding for abstract class Mid. Required by Service constructor param #0 \`port\`. Fix: bind it to a concrete class in a service provider \`register()\`, e.g. \`container.bind(Mid, Impl)\`."`)
  })

  it('does not flag a concrete subclass, which autowires with the inherited deps', () => {
    const port = container().make(SmtpPort)
    expect(port).toBeInstanceOf(SmtpPort)
    expect(port.clock).toBeInstanceOf(Clock)
  })

  it('resolves through its binding', () => {
    expect(container().bind(Mid, SmtpPort).make(Mid)).toBeInstanceOf(SmtpPort)
  })
})
