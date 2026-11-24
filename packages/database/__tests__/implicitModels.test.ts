// H14 #163: the v1 implicit model map of the app manifest (docs/v1/http.md › Model binding): one default BindableModel
// per model file, keyed by camelize(<file name>), the same key sauf writes into `.laratype/types/models.d.ts`.
import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'vitest'
import { Container, depsRegistry } from '@laratype/core'
import { Config, ModelBindingRegistry, setAppManifest } from '@laratype/support'
import type { AppManifest, ManifestEntry } from '@laratype/support'
import Model from '../src/eloquent/Model'
import ModelError from '../src/exceptions/ModelError'
import DatabaseServiceProvider, { implicitRouteModels } from '../src/providers/EloquentServiceProvider'

class User extends Model {
  declare id: number
}
class Post extends Model {
  declare id: number
}

const entry = (name: string, module: object = { default: User }): ManifestEntry => ({ name, path: `app/models/${name}.ts`, load: async () => module })

const manifest = (...models: ManifestEntry[]): AppManifest => ({
  configs: [],
  routes: [],
  commands: [],
  models,
  migrations: [],
  seeders: [],
  factories: [],
  modules: [],
  lang: [],
})

afterEach(() => {
  Config.setConfigs(undefined)
})

describe('implicitRouteModels (H14 #163)', () => {
  it('keys the default export by the model file name, camelized', () => {
    const map = implicitRouteModels(
      [entry('User'), entry('PersonalAccessToken')],
      [{ default: User }, { default: Post }],
    )
    expect(Object.keys(map)).toEqual(['user', 'personalAccessToken'])
    expect(map.user).toBe(User)
    expect(map.personalAccessToken).toBe(Post)
  })

  it('reads the file name, not the class name: the typegen can only see file names', () => {
    class Whatever extends Model {
      declare id: number
    }
    const map = implicitRouteModels([entry('user')], [{ default: Whatever }])
    expect(map).toEqual({ user: Whatever })
  })

  it('refuses two files whose names camelize to the same key', () => {
    expect(() => implicitRouteModels([entry('User'), entry('user')], [{ default: User }, { default: Post }])).toThrow(
      '[@laratype/database] app/models/User.ts and app/models/user.ts are both the implicit model `user`: rename one (a model file\'s name is its path param)',
    )
  })

  it('refuses a model file named __proto__', () => {
    expect(() => implicitRouteModels([entry('__proto__')], [{ default: User }])).toThrow(
      '[@laratype/database] app/models/__proto__.ts: a model file cannot be named `__proto__`: every object reads it as its prototype, so the binding would be dropped',
    )
  })

  it('refuses a module without a default export and a default export that is not a BindableModel', () => {
    expect(() => implicitRouteModels([entry('User')], [{ User }])).toThrow(
      '[@laratype/database] app/models/User.ts has no default export: a model file exports its model class as the default export for implicit binding',
    )
    class Plain {
      declare id: number
    }
    expect(() => implicitRouteModels([entry('User')], [{ default: Plain }])).toThrow(
      '[@laratype/database] app/models/User.ts: the default export is not a BindableModel (static primaryKey, optional routeKeyName, findByRouteKey(key))',
    )
    // A call signature alone is not a model either
    expect(() => implicitRouteModels([entry('User')], [{ default: () => new Plain() }])).toThrow(ModelError)
  })

  it('refuses a manifest entry with no name or path, before building a key', () => {
    expect(() => implicitRouteModels([{ path: 'app/models/User.ts' } as ManifestEntry], [{ default: User }])).toThrow(
      "[@laratype/database] the app manifest's models[0] has no name",
    )
    expect(() => implicitRouteModels([{ name: 'User' } as ManifestEntry], [{ default: User }])).toThrow(
      "[@laratype/database] the app manifest's models[0] has no path",
    )
  })

  it('keeps an Object.prototype member name as an own key (the map is built with Object.fromEntries)', () => {
    const map = implicitRouteModels([entry('constructor')], [{ default: User }])
    expect(Object.hasOwn(map, 'constructor')).toBe(true)
    expect(map.constructor).toBe(User)
  })
})

describe('DatabaseServiceProvider fills routeModels (H14 #163)', () => {
  it('fills the v1 map from the same manifest pass that fills the 0.5 maps', async () => {
    Config.setConfigs({ database: { default: 'mysql', connections: { mysql: { type: 'mysql', host: 'localhost', database: 'test' } } } })
    setAppManifest(manifest(entry('User'), entry('Post', { default: Post })))
    const container = new Container({ deps: depsRegistry })
    const provider = new DatabaseServiceProvider(container)
    await provider.getDataSource()
    const registry = container.make(ModelBindingRegistry)
    expect(registry.routeModels).toEqual({ user: User, post: Post })
    // The 0.5 maps are unchanged: every export by class name, and its camelized param key
    expect(registry.models).toEqual({ User, Post })
    expect(registry.paramModelMap).toEqual({ user: 'User', post: 'Post' })
  })
})
