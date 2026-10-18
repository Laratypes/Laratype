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

describe('bootProviders failure', () => {
  it('runs every down() in reverse order and rethrows when a boot throws', async () => {
    const calls: string[] = []
    const make = (name: string, fail = false) => class extends ServiceProvider {
      boot() {
        calls.push(`${name}.boot`)
        if (fail) throw new Error(`${name} failed`)
      }
      async down() {
        calls.push(`${name}.down`)
        if (name === 'b') throw new Error('down errors are ignored')
      }
    }
    await expect(bootProviders(makeApp(), [make('a'), make('b'), make('c', true), make('d')])).rejects.toThrow('c failed')
    expect(calls).toEqual(['a.boot', 'b.boot', 'c.boot', 'd.down', 'c.down', 'b.down', 'a.down'])
  })
})

describe('bootProviders rollback', () => {
  it('survives a down() that throws synchronously or returns no promise', async () => {
    const calls: string[] = []
    class SyncThrow extends ServiceProvider {
      // @ts-expect-error a provider that breaks the contract: down() is not async
      down() { calls.push('sync.down'); throw new Error('sync') }
    }
    class Plain extends ServiceProvider {
      // @ts-expect-error a provider that returns no promise
      down() { calls.push('plain.down') }
    }
    class Fails extends ServiceProvider {
      boot() { throw new Error('boot failed') }
    }
    await expect(bootProviders(makeApp(), [Plain, SyncThrow, Fails])).rejects.toThrow('boot failed')
    expect(calls).toEqual(['sync.down', 'plain.down'])
  })
})

describe('bootProviders rollback scope', () => {
  const log: string[] = []
  const make = (name: string, opts: { failRegister?: boolean, failConstruct?: boolean, failDown?: boolean } = {}) => class extends ServiceProvider {
    constructor(app: Container) {
      if (opts.failConstruct) throw new Error(`${name} constructor failed`)
      super(app)
    }
    register() {
      log.push(`${name}.register`)
      if (opts.failRegister) throw new Error(`${name} register failed`)
    }
    async down() {
      log.push(`${name}.down`)
      if (opts.failDown) throw new Error(`${name} down failed`)
    }
  }

  it('rolls back only the providers whose register() ran', async () => {
    log.length = 0
    await expect(bootProviders(makeApp(), [make('a'), make('b', { failRegister: true }), make('c')])).rejects.toThrow('b register failed')
    expect(log).toEqual(['a.register', 'b.register', 'b.down', 'a.down'])
  })

  it('a throwing constructor rolls back the earlier providers', async () => {
    log.length = 0
    await expect(bootProviders(makeApp(), [make('a'), make('b', { failConstruct: true }), make('c')])).rejects.toThrow('b constructor failed')
    expect(log).toEqual(['a.register', 'a.down'])
  })

  it('logs a failing down() during rollback and still rethrows the original error', async () => {
    log.length = 0
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(bootProviders(makeApp(), [make('a', { failDown: true }), make('b', { failRegister: true })])).rejects.toThrow('b register failed')
    expect(log).toEqual(['a.register', 'b.register', 'b.down', 'a.down'])
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]![0])).toContain('down() failed while rolling back a failed boot')
    error.mockRestore()
  })
})
