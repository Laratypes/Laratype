import { afterEach, describe, expect, it } from 'vitest'
import { Container, Facade } from '@laratype/core'
import ContextApi from '../src/context/ContextApi'
import ModelBindingRegistry from '../src/registries/ModelBindingRegistry'
import RouteRegistry from '../src/registries/RouteRegistry'

afterEach(() => {
  Facade.setFacadeApplication(undefined)
})

describe('RouteRegistry', () => {
  it('current() returns the registry bound in the facade application', () => {
    const routes = [{ path: '/x' }]
    const app = new Container().instance(RouteRegistry, new RouteRegistry(routes))
    Facade.setFacadeApplication(app)
    expect(RouteRegistry.current().routes).toBe(routes)
  })

  it('current() binds an empty registry when the facade application has none', () => {
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(RouteRegistry.current()).toBe(app.make(RouteRegistry))
    expect(RouteRegistry.current().routes).toEqual([])
  })
})

describe('ModelBindingRegistry', () => {
  it('container() is the request container, else the facade application', () => {
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(ModelBindingRegistry.container()).toBe(app)
    const request = new Container()
    ContextApi.run({ container: request } as any, () => {
      expect(ModelBindingRegistry.container()).toBe(request)
    })
  })

  it('prefers the request container over the facade application', () => {
    const request = new Container()
    const app = new Container()
    Facade.setFacadeApplication(app)
    ContextApi.run({ container: request } as any, () => {
      expect(ModelBindingRegistry.current()).toBe(request.make(ModelBindingRegistry))
      expect(app.has(ModelBindingRegistry)).toBe(false)
    })
  })

  it('does not read the container of a finished request (D11 #318)', () => {
    const app = new Container()
    Facade.setFacadeApplication(app)
    const request = new Container()
    let requestRegistry: ModelBindingRegistry | undefined
    ContextApi.run({ container: request } as any, () => {
      expect(ModelBindingRegistry.container()).toBe(request)
      requestRegistry = ModelBindingRegistry.current()
    })
    // Outside the request the store is empty: the app container answers, not the finished request's scope
    expect(ModelBindingRegistry.container()).toBe(app)
    expect(ModelBindingRegistry.current()).not.toBe(requestRegistry)
  })

  it('current() binds one registry per container', () => {
    Facade.setFacadeApplication(new Container())
    expect(ModelBindingRegistry.current()).toBe(ModelBindingRegistry.current())
    const registry = ModelBindingRegistry.current()
    expect(registry.bindings).toEqual({})
    expect(registry.paramModelMap).toEqual({})
    expect(registry.models).toEqual({})
    // The v1 implicit map (H14 #163) starts empty, next to the 0.5 ones
    expect(registry.routeModels).toEqual({})
  })
})
