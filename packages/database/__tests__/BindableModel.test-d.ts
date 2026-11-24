// Type test for the BindableModel static interface (docs/v1/database.md › BindableModel, H7 #118): a model class
// `r.bind()` takes has primaryKey, an optional routeKeyName and findByRouteKey on its static side.
import { describe, expectTypeOf, it } from 'vitest'
import type { BindableModel } from '../src/index'

class User {
  declare readonly id: number
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string): Promise<User | null> { return key === '' ? null : new User() }
}

class Post {
  declare readonly id: number
  static readonly primaryKey = 'id'
  static readonly routeKeyName = 'slug'
  static findByRouteKey(key: string): Promise<Post | null> { return Promise.resolve(new Post()) }
}

class Plain {
  declare readonly id: number
}

describe('BindableModel', () => {
  it('is the static side: a class with primaryKey and findByRouteKey fits, routeKeyName optional', () => {
    expectTypeOf<typeof User>().toMatchTypeOf<BindableModel>()
    expectTypeOf<typeof Post>().toMatchTypeOf<BindableModel>()
    expectTypeOf<BindableModel>().toHaveProperty('primaryKey')
    expectTypeOf<BindableModel['routeKeyName']>().toEqualTypeOf<string | undefined>()
  })

  it('a class without the statics does not fit', () => {
    expectTypeOf<typeof Plain>().not.toMatchTypeOf<BindableModel>()
  })
})
