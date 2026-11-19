// Type surface of the v1 Model: typed columns, the find overloads, the page type, and the structural BindableModel
// check (docs/v1/database.md › Model, › BindableModel).
import { describe, expectTypeOf, it } from 'vitest'
import Model, { type ModelClass, type PrimaryKeyValue } from '../src/eloquent/Model'
import type ModelQueryBuilder from '../src/eloquent/ModelQueryBuilder'
import {
  type ColumnKey,
  type ModelWhere,
  type OrderDirection,
  type Page,
  type WhereComparison,
  type WhereOperator,
} from '../src/eloquent/ModelQueryBuilder'

// A3 #121 puts an optional unique-symbol brand on a model; it must never be a column
const HasPolicy: unique symbol = Symbol('laratype.hasPolicy')

class User extends Model {
  declare readonly id: number
  declare readonly email: string
  declare readonly isActive: boolean
  declare readonly createdAt: Date
  declare readonly deletedAt: Date | null
  declare readonly [HasPolicy]?: true
}

describe('Model and ModelQueryBuilder types', () => {
  it('types the columns from the entity data properties, never a method or a symbol brand', () => {
    expectTypeOf<ColumnKey<User>>().toEqualTypeOf<'id' | 'email' | 'isActive' | 'createdAt' | 'deletedAt'>()
    expectTypeOf<ModelWhere<User>>().toEqualTypeOf<{
      id?: number
      email?: string
      isActive?: boolean
      createdAt?: Date
      // null is not a where() value, in any form (docs/v1/database.md › Model)
      deletedAt?: Date
    }>()
  })

  it('gives the public generic types a wide default, so the bare name is usable', () => {
    expectTypeOf<ColumnKey>().toEqualTypeOf<string>()
    expectTypeOf<Page>().toEqualTypeOf<Page<any>>()
    const where: ModelWhere = { anything: 1, another: 'ada' }
    expectTypeOf(where).toExtend<{ [key: string]: any }>()
  })

  it('returns the typed builder from query()', () => {
    expectTypeOf(User.query()).toEqualTypeOf<ModelQueryBuilder<User>>()
  })

  it('types where() with the column value, the operator allowlist and the array operators', () => {
    const query = User.query()
    expectTypeOf(query.where('email', 'ada@example.com')).toEqualTypeOf<ModelQueryBuilder<User>>()
    expectTypeOf(query.where('id', '>', 1)).toEqualTypeOf<ModelQueryBuilder<User>>()
    expectTypeOf(query.where('id', 'in', [1, 2])).toEqualTypeOf<ModelQueryBuilder<User>>()
    expectTypeOf(query.where({ email: 'ada@example.com', isActive: true })).toEqualTypeOf<ModelQueryBuilder<User>>()
  })

  it('types orderBy, limit, first, get and paginate', () => {
    expectTypeOf(User.query().orderBy('email')).toEqualTypeOf<ModelQueryBuilder<User>>()
    expectTypeOf(User.query().orderBy('email', 'desc')).toEqualTypeOf<ModelQueryBuilder<User>>()
    expectTypeOf(User.query().limit(10)).toEqualTypeOf<ModelQueryBuilder<User>>()
    expectTypeOf(User.query().first()).toEqualTypeOf<Promise<User | null>>()
    expectTypeOf(User.query().get()).toEqualTypeOf<Promise<User[]>>()
    expectTypeOf(User.query().paginate()).toEqualTypeOf<Promise<Page<User>>>()
  })

  it('gives the page its plain, read-only shape', () => {
    expectTypeOf<Page<User>>().toEqualTypeOf<{
      readonly data: readonly User[]
      readonly total: number
      readonly perPage: number
      readonly currentPage: number
      readonly lastPage: number
    }>()
  })

  it('sticks to the operator and direction unions', () => {
    expectTypeOf<WhereComparison>().toEqualTypeOf<'=' | '!=' | '<' | '<=' | '>' | '>=' | 'like' | 'not like'>()
    expectTypeOf<WhereOperator>().toEqualTypeOf<WhereComparison | 'in' | 'not in'>()
    expectTypeOf<OrderDirection>().toEqualTypeOf<'asc' | 'desc'>()
  })

  it('refuses a column that is not a data property, a wrong value type and a bad direction', () => {
    typeOnly(() => {
      // @ts-expect-error "nope" is not a column of User
      User.query().where('nope', 1)
      // @ts-expect-error a method is not a column
      User.query().where('save', async () => undefined)
      // @ts-expect-error the symbol brand is not a column
      User.query().where(HasPolicy, true)
      // @ts-expect-error id is a number
      User.query().where('id', 'not a number')
      // @ts-expect-error "in" takes an array
      User.query().where('id', 'in', 1)
      // @ts-expect-error a direction is asc or desc
      User.query().orderBy('email', 'sideways')
      // @ts-expect-error "nope" is not a column of User
      User.query().where({ nope: 1 })
      // @ts-expect-error null is not a where value, even for a nullable column
      User.query().where('deletedAt', null)
      // @ts-expect-error the object form excludes null too
      User.query().where({ deletedAt: null })
      // @ts-expect-error a comparison value excludes null
      User.query().where('deletedAt', '=', null)
      // @ts-expect-error an in list element excludes null
      User.query().where('deletedAt', 'in', [null])
    })
    // A Date stays a valid value for the nullable column
    expectTypeOf(User.query().where('deletedAt', new Date())).toEqualTypeOf<ModelQueryBuilder<User>>()
  })

  it('types find, findOrFail, findByRouteKey and getRouteKey', () => {
    expectTypeOf(User.find(1)).toEqualTypeOf<Promise<User | null>>()
    expectTypeOf(User.find('1')).toEqualTypeOf<Promise<User | null>>()
    expectTypeOf(User.find(1n)).toEqualTypeOf<Promise<User | null>>()
    expectTypeOf(User.find()).toEqualTypeOf<Promise<User[]>>()
    expectTypeOf(User.find({ where: { email: 'ada@example.com' } })).toEqualTypeOf<Promise<User[]>>()
    expectTypeOf(User.findOrFail(1)).toEqualTypeOf<Promise<User>>()
    expectTypeOf(User.findByRouteKey('1')).toEqualTypeOf<Promise<User | null>>()
    // The raw 0.5 form keeps TypeORM's `any` return, so an existing `const rows: User[] = await User.query(sql)` compiles
    expectTypeOf(User.query('SELECT 1')).toEqualTypeOf<Promise<any>>()
    expectTypeOf(new User().getRouteKey()).toEqualTypeOf<string | number | bigint | boolean | Date>()
    expectTypeOf<PrimaryKeyValue>().toEqualTypeOf<string | number | bigint>()
    expectTypeOf(User).toExtend<ModelClass<User>>()
  })

  it('satisfies the BindableModel shape of database.md › BindableModel', () => {
    interface BindableModel<M extends object = object> {
      new (...args: any[]): M
      readonly primaryKey: string
      readonly routeKeyName?: string
      findByRouteKey(key: string): Promise<M | null | undefined>
    }

    const bindable = <C extends BindableModel>(model: C): C => model
    expectTypeOf(bindable(User)).toEqualTypeOf<typeof User>()
    // A subclass that sets routeKeyName has the narrower literal, and is still bindable
    class Post extends Model {
      declare readonly id: number
      declare readonly slug: string
      static override readonly routeKeyName = 'slug'
    }
    expectTypeOf(bindable(Post)).toEqualTypeOf<typeof Post>()
    expectTypeOf(Post.routeKeyName).toEqualTypeOf<string>()
  })
})

/** A body that must only compile: the type tests never run it, so the calls above have no side effect. */
function typeOnly(fn: () => void): void {
  void fn
}
