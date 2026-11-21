// D7 #114: the 0.5 Route.bind / Route.model bindings live in the app container's ModelBindingRegistry
import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry, Facade } from '@laratype/core'
import { bootProviders, HTTP_APP, InternalException, ModelBindingRegistry, ServiceProvider } from '@laratype/support'
import { Controller, RequestKernel, Route } from '../../src/index'

/** An app booted like `sauf dev`, with the facade application the kernel sets. */
const boot = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  Facade.setFacadeApplication(container)
  new RequestKernel(container).boot()
  return { app, container, registry: container.make(ModelBindingRegistry) }
}

afterEach(() => {
  Facade.setFacadeApplication(undefined)
})

class Legacy extends Controller {
  show(_request: unknown, bindings: Record<string, unknown>) {
    return bindings
  }
}

describe('the 0.5 route model bindings', () => {
  it('Route.bind writes the binding into the app registry and the request resolves it', async () => {
    const { app, registry } = boot()
    const resolver = (value: string) => ({ id: Number(value) })
    Route.bind('user', resolver)
    expect(registry.bindings.user).toBe(resolver)

    app.get('/legacy/users/:user', RequestKernel.handle({ method: 'get', path: '/legacy/users/:user', controller: [Legacy, 'show'] }))
    expect(await (await app.request('/legacy/users/7')).json()).toEqual({ user: { id: 7 } })
  })

  it('a bare bootProviders() boot writes the binder the request path reads', async () => {
    // No Serve and no manual setFacadeApplication(): the bare boot supplies the facade application
    Facade.setFacadeApplication(undefined)

    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    class User {
      static dataSource = {}
      static getRepository() {
        return { metadata: { primaryColumns: [{ propertyName: 'id' }] } }
      }
      // The implicit primary-key lookup that would run without the restricted binder
      static findOne = vi.fn(async () => ({ id: 1, tenantId: 'another-tenant' }))
    }
    const registry = new ModelBindingRegistry()
    registry.models = { User }
    registry.paramModelMap = { user: 'User' }
    container.instance(ModelBindingRegistry, registry)

    class Binder extends ServiceProvider {
      boot() {
        Route.bind('user', (value) => ({ id: Number(value), tenantId: 'tenant-7' }))
      }
    }

    await bootProviders(container, [RequestKernel, Binder])
    expect(Facade.getFacadeApplication()).toBe(container)
    expect(container.make(ModelBindingRegistry).bindings.user).toBeTypeOf('function')

    app.get('/legacy/users/:user', RequestKernel.handle({ method: 'get', path: '/legacy/users/:user', controller: [Legacy, 'show'] }))
    expect(await (await app.request('/legacy/users/7')).json()).toEqual({
      user: { id: 7, tenantId: 'tenant-7' },
    })
    expect(User.findOne).not.toHaveBeenCalled()
  })

  it('Route.bind() throws before an app is booted', () => {
    expect(() => Route.bind('user', () => null)).toThrow(InternalException)
    expect(() => Route.bind('user', () => null)).toThrow('[@laratype/http] Route.bind() ran before an app was booted')
  })

  it('Route.model() throws before an app is booted', () => {
    expect(() => Route.model('user', class User {})).toThrow(InternalException)
    expect(() => Route.model('user', class User {})).toThrow('[@laratype/http] Route.model() ran before an app was booted')
  })

  it('RequestKernel.register() clears the route bindings and keeps the models and the param map', () => {
    const container = new Container({ deps: depsRegistry })
    container.instance(HTTP_APP, new Hono())
    class User {}
    const registry = new ModelBindingRegistry()
    registry.bindings = { user: () => null }
    registry.models = { User }
    registry.paramModelMap = { user: 'User' }
    container.instance(ModelBindingRegistry, registry)

    new RequestKernel(container).register()

    expect(container.make(ModelBindingRegistry).bindings).toEqual({})
    expect(container.make(ModelBindingRegistry).models).toEqual({ User })
    expect(container.make(ModelBindingRegistry).paramModelMap).toEqual({ user: 'User' })
  })

  it('keeps a binder an app provider registers in register(), before the kernel boots', async () => {
    const container = new Container({ deps: depsRegistry })
    container.instance(HTTP_APP, new Hono())
    Facade.setFacadeApplication(container)
    const binder = (value: string) => ({ id: Number(value) })
    class RegistersBinder extends ServiceProvider {
      register() {
        Route.bind('user', binder)
      }
    }

    // bootstrap's order: RequestKernel first, then the app providers
    await bootProviders(container, [RequestKernel, RegistersBinder])

    expect(container.make(ModelBindingRegistry).bindings.user).toBe(binder)
  })
})
