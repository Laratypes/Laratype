import { describe, expect, it } from 'vitest'
import { Container, DiError, Inject, __laratype_deps, depsRegistry, token } from '@laratype/core'
import type { DepsEntry } from '@laratype/core'

/** Resolution error messages with fix hints (D5a #100). */

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
