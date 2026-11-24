// Type tests for typed implicit model binding (H14 #163): `params.user: User` without a `r.bind()` or a `Requires`
// entry. The registered keys are `zzUser` / `zzPost`, which no other type-test file's path declares: the vitest
// typecheck project is one program, so this `declare module` is global.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, Route } from '../../src/index'
import type { Ctx, RouteProof } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

class ZzUser {
  static readonly primaryKey = 'id'
  static async findByRouteKey(_key: string): Promise<ZzUser | null> { return null }
  declare readonly id: number
  declare readonly slug: string
}
class ZzPost {
  static readonly primaryKey = 'id'
  static async findByRouteKey(_key: string, _scope?: Readonly<Record<string, object>>): Promise<ZzPost | null> { return null }
  declare readonly id: number
  declare readonly slug: string
}
class Unregistered {
  declare readonly id: number
}

/** A shape no registered model has: a structural difference the proof reports. */
class OtherShape {
  declare readonly id: string
}

// The generated `.laratype/types/models.d.ts` augmentation (docs/v1/http.md › Model binding)
declare module '@laratype/http' {
  interface Register {
    models: {
      zzUser: typeof ZzUser
      zzPost: typeof ZzPost
    }
  }
}

const users = defineContract()({
  show: endpoint.get('/:zzUser').response(anything),
  latest: endpoint.get('/latest/:zzPost?').response(anything),
  other: endpoint.get('/other/:unregistered').response(anything),
})
const usersApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [] } })

const rootScope = defineScope()({})
const folderScope = defineScope<ContractPrefix<'/api/zzUsers/:zzUser/posts', [typeof rootScope]>>()({})
const nested = defineContract()({ show: endpoint.get('/:zzPost').response(anything) })
const nestedApi = defineApi({
  'users.posts': {
    contract: nested,
    path: '/api/zzUsers/:zzUser/posts',
    scopes: [{ scope: rootScope, dir: '' }, { scope: folderScope, dir: 'zzUsers/[zzUser]' }],
  },
})

/** A handler that reads the implicit model from `Ctx` and never lists it in `Requires`. */
class UsersController extends Controller {
  show(ctx: Ctx<typeof users.show>) {
    expectTypeOf(ctx.params.zzUser).toEqualTypeOf<ZzUser>()
    return { id: ctx.params.zzUser.id }
  }
  latest(ctx: Ctx<typeof users.latest>) {
    expectTypeOf(ctx.params.zzPost).toEqualTypeOf<ZzPost | undefined>()
    return { slug: ctx.params.zzPost?.slug ?? '' }
  }
  other(ctx: Ctx<typeof users.other>) {
    expectTypeOf(ctx.params.unregistered).toEqualTypeOf<string>()
    return { id: ctx.params.unregistered }
  }
}

describe('Ctx applies the registered models (H14 #163)', () => {
  test('the endpoint own path params get the model type, a folder param stays in Requires', () => {
    expectTypeOf<Ctx<typeof users.show>['params']>().toEqualTypeOf<{ zzUser: ZzUser }>()
    expectTypeOf<Ctx<typeof users.latest>['params']>().toEqualTypeOf<{ zzPost: ZzPost | undefined }>()
    // A folder param is not in the endpoint path: it is still listed in Requires
    expectTypeOf<Ctx<typeof nested.show>['params']>().toEqualTypeOf<{ zzPost: ZzPost }>()
    expectTypeOf<Ctx<typeof nested.show, { params: { zzUser: ZzUser } }>['params']>().toEqualTypeOf<{
      zzPost: ZzPost
      zzUser: ZzUser
    }>()
  })

  test('an unregistered param stays a string', () => {
    expectTypeOf<Ctx<typeof users.other>['params']>().toEqualTypeOf<{ unregistered: string }>()
  })
})

describe('the route proof provides the implicit models (H14 #163)', () => {
  test('a handler typed with Ctx alone passes without .bind()', () => {
    Route.api(usersApi, (r) => [r.contract(users, UsersController)])
    expectTypeOf<RouteProof<typeof usersApi, typeof users, UsersController, { readonly policy: undefined }>>().toEqualTypeOf<unknown>()
  })

  test('an explicit .bind() keeps its binder type over the registered model', () => {
    class BoundController extends Controller {
      show(ctx: Ctx<typeof users.show, { params: { zzUser: { bound: true } } }>) {
        expectTypeOf(ctx.params.zzUser).toEqualTypeOf<{ bound: true }>()
        return {}
      }
      latest() { return {} }
      other() { return {} }
    }
    Route.api(usersApi, (r) => [r.bind({ zzUser: () => ({ bound: true as const }) }).contract(users, BoundController)])
  })

  test('.withoutImplicitBinding() keeps the string, so a handler that needs the model fails with H7 diagnosis', () => {
    expectTypeOf<RouteProof<typeof usersApi, typeof users, UsersController, { readonly policy: undefined }, {}, {}, true>>().toHaveProperty(
      'users.show: `params.zzUser` provided by the route does not match the handler (missing .bind()?)',
    )
    Route.api(usersApi, (r) => [
      // @ts-expect-error users.show: `params.zzUser` provided by the route does not match the handler (missing .bind()?)
      r.withoutImplicitBinding().contract(users, UsersController),
    ])
  })

  test('a handler that needs a model the route does not provide keeps the H7 diagnosis', () => {
    class WrongController extends Controller {
      show(ctx: Ctx<typeof users.show, { params: { zzUser: OtherShape } }>) { return {} }
      latest() { return {} }
      other() { return {} }
    }
    expectTypeOf<RouteProof<typeof usersApi, typeof users, WrongController, { readonly policy: undefined }>>().toHaveProperty(
      'users.show: `params.zzUser` provided by the route does not match the handler (missing .bind()?)',
    )
  })

  test('a numeric bind key is normalized to the string the runtime uses (H7 #118 follow-up)', () => {
    const numeric = defineContract()({ show: endpoint.get('/:123').response(anything) })
    const numericApi = defineApi({ numeric: { contract: numeric, path: '/api/numeric', scopes: [] } })
    class NumericController extends Controller {
      show(ctx: Ctx<typeof numeric.show, { params: { "123": ZzUser } }>) {
        expectTypeOf(ctx.params['123']).toEqualTypeOf<ZzUser>()
        return {}
      }
    }
    Route.api(numericApi, (r) => [r.bind({ 123: ZzUser }).contract(numeric, NumericController)])
    expectTypeOf<
      RouteProof<typeof numericApi, typeof numeric, NumericController, { readonly policy: undefined }, {}, { "123": typeof ZzUser }>
    >().toEqualTypeOf<unknown>()
  })
})

describe('contract policies read the implicit models too (H8 #122)', () => {
  const secured = defineScope()({ auth: true, authorize: true })
  const securedContract = defineContract<ContractPrefix<'/api/secure', [typeof secured]>>()({
    show: endpoint.get('/:zzUser').response(anything),
  })
  const securedApi = defineApi({ secure: { contract: securedContract, path: '/api/secure', scopes: [{ scope: secured, dir: '' }] } })
  class ShowPolicy {
    show(_user: unknown, zzUser: ZzUser) { return zzUser.id > 0 }
  }
  class WrongShowPolicy {
    show(_user: unknown, zzUser: { id: string }) { return zzUser.id !== '' }
  }
  class SecuredController extends Controller {
    show() { return {} }
  }

  test('a policy method accepts an implicit model it names', () => {
    Route.api(securedApi, (r) => [
      r.scope('', { policy: ShowPolicy }),
      r.contract(securedContract, SecuredController, { policy: ShowPolicy }),
    ])
    expectTypeOf<RouteProof<typeof securedApi, typeof securedContract, SecuredController, { readonly policy: typeof ShowPolicy }>>().toEqualTypeOf<unknown>()
  })

  test('a policy method with the wrong model type is reported', () => {
    expectTypeOf<RouteProof<typeof securedApi, typeof securedContract, SecuredController, { readonly policy: typeof WrongShowPolicy }>>().toHaveProperty(
      "secure.show: the policy's `show` method does not accept the bound models the route passes (zzUser)",
    )
  })
})
