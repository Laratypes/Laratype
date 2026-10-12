import { describe, expect, it } from 'vitest'
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
