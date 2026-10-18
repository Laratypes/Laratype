import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, token } from '@laratype/core'
import { AppServiceProvider, bootProviders, HTTP_APP, RouteAppServiceProvider, ServiceProvider } from '../src/ServiceProvider'

const makeApp = () => new Container().instance(HTTP_APP, new Hono())

describe('ServiceProvider v2', () => {
  it('receives the container as this.app', () => {
    const app = makeApp()
    const provider = new ServiceProvider(app)
    expect(provider.app).toBe(app)
  })

  it('AppServiceProvider resolves the Hono instance from the container', () => {
    const app = makeApp()
    const provider = new AppServiceProvider(app)
    expect(provider.app).toBe(app)
    expect(provider.apps).toBe(app.make(HTTP_APP))
  })

  it('RouteAppServiceProvider stores its routes on boot', async () => {
    const routes = [{ path: '/x' }]
    class Routes extends RouteAppServiceProvider {
      routes() {
        return routes
      }
    }
    await bootProviders(makeApp(), [Routes])
    expect(globalThis.__laratype_routes).toBe(routes)
  })
})

describe('bootProviders', () => {
  it('calls register() on every provider before any boot()', async () => {
    const calls: string[] = []
    const make = (name: string) => class extends ServiceProvider {
      async register() {
        await Promise.resolve()
        calls.push(`${name}.register`)
      }
      boot() {
        calls.push(`${name}.boot`)
      }
    }
    await bootProviders(makeApp(), [make('a'), make('b'), make('c')])
    expect(calls).toEqual(['a.register', 'b.register', 'c.register', 'a.boot', 'b.boot', 'c.boot'])
  })

  it('lets boot() use bindings registered by a later provider', async () => {
    const GREETING = token<string>('greeting')
    let seen: string | undefined
    class Consumer extends ServiceProvider {
      boot() {
        seen = this.app.make(GREETING)
      }
    }
    class Binder extends ServiceProvider {
      register() {
        this.app.instance(GREETING, 'hello')
      }
    }
    await bootProviders(makeApp(), [Consumer, Binder])
    expect(seen).toBe('hello')
  })

  it('shares one container across providers', async () => {
    const app = makeApp()
    const seen: Container[] = []
    class P extends ServiceProvider {
      register() {
        seen.push(this.app)
      }
    }
    await bootProviders(app, [P, P])
    expect(seen).toEqual([app, app])
  })

  it('returns down() cleanups in reverse order', async () => {
    const calls: string[] = []
    const make = (name: string) => class extends ServiceProvider {
      async down() {
        calls.push(name)
      }
    }
    const downs = await bootProviders(makeApp(), [make('a'), make('b')])
    for (const down of downs) await down()
    expect(calls).toEqual(['b', 'a'])
  })
})

describe('HTTP_APP', () => {
  it('is shared through globalThis so duplicated bundles use the same key', () => {
    expect((globalThis as { __laratype_http_app_token?: unknown }).__laratype_http_app_token).toBe(HTTP_APP)
  })
})

describe('bootProviders rollback', () => {
  const log: string[] = []
  const make = (name: string, opts: { failConstruct?: boolean, failRegister?: boolean, failBoot?: boolean, failDown?: boolean, syncDown?: boolean } = {}) =>
    class extends ServiceProvider {
      constructor(app: Container) {
        if (opts.failConstruct) throw new Error(`${name} constructor failed`)
        super(app)
      }
      register() {
        log.push(`${name}.register`)
        if (opts.failRegister) throw new Error(`${name} register failed`)
      }
      boot() {
        log.push(`${name}.boot`)
        if (opts.failBoot) throw new Error(`${name} boot failed`)
      }
      // @ts-expect-error some providers break the contract: a synchronous down() that throws
      down() {
        log.push(`${name}.down`)
        if (opts.syncDown) throw new Error(`${name} sync down failed`)
        if (opts.failDown) return Promise.reject(new Error(`${name} down failed`))
        return undefined
      }
    }
  const run = (Providers: Array<typeof ServiceProvider>) => {
    log.length = 0
    return bootProviders(makeApp(), Providers)
  }

  it('a boot failure in B downs A only (not B, C or D), in reverse order, and rethrows', async () => {
    await expect(run([make('a'), make('b', { failBoot: true }), make('c'), make('d')])).rejects.toThrow('b boot failed')
    expect(log).toEqual(['a.register', 'b.register', 'c.register', 'd.register', 'a.boot', 'b.boot', 'a.down'])
  })

  it('downs the booted providers in reverse order', async () => {
    await expect(run([make('a'), make('b'), make('c', { failBoot: true })])).rejects.toThrow('c boot failed')
    expect(log.filter((l) => l.endsWith('.down'))).toEqual(['b.down', 'a.down'])
  })

  it('a register failure downs none', async () => {
    await expect(run([make('a'), make('b', { failRegister: true }), make('c')])).rejects.toThrow('b register failed')
    expect(log).toEqual(['a.register', 'b.register'])
  })

  it('a constructor failure downs none', async () => {
    await expect(run([make('a'), make('b', { failConstruct: true }), make('c')])).rejects.toThrow('b constructor failed')
    expect(log).toEqual([])
  })

  it('logs a failing down() (async or sync) and still rethrows the original error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(run([make('a', { failDown: true }), make('b', { syncDown: true }), make('c', { failBoot: true })])).rejects.toThrow('c boot failed')
    expect(log.filter((l) => l.endsWith('.down'))).toEqual(['b.down', 'a.down'])
    expect(error).toHaveBeenCalledTimes(2)
    expect(String(error.mock.calls[0]![0])).toContain('down() failed while rolling back a failed boot')
    error.mockRestore()
  })
})
