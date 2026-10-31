// D7 #114: the 0.5 Route.bind / Route.model bindings live in the app container's ModelBindingRegistry
import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry, Facade } from '@laratype/core'
import { HTTP_APP, ModelBindingRegistry } from '@laratype/support'
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

  it('RequestKernel.boot() clears the route bindings and keeps the models and the param map', () => {
    const container = new Container({ deps: depsRegistry })
    container.instance(HTTP_APP, new Hono())
    class User {}
    const registry = new ModelBindingRegistry()
    registry.bindings = { user: () => null }
    registry.models = { User }
    registry.paramModelMap = { user: 'User' }
    container.instance(ModelBindingRegistry, registry)

    new RequestKernel(container).boot()

    expect(container.make(ModelBindingRegistry).bindings).toEqual({})
    expect(container.make(ModelBindingRegistry).models).toEqual({ User })
    expect(container.make(ModelBindingRegistry).paramModelMap).toEqual({ user: 'User' })
  })
})
