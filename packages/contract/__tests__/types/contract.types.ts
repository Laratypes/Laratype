// Type tests: compiled by ../typecheck.test.ts with tsc, so a broken expectation fails `vitest run`.
import { expectTypeOf } from 'vitest'
import * as z from 'zod'
import { API_ROOT, apiEndpoint, apiRoutes, defineApi, defineContract, defineScope, endpoint, isApiNode, isApiRoot, isContract } from '@laratype/contract'
import type {
  AnyApiNode,
  AnyContract,
  Api,
  ApiEndpoint,
  ApiRoute,
  ApiRouteName,
  ApiShape,
  ApiTypes,
  Contract,
  ContractPrefix,
  ContractPrefixOf,
  Endpoint,
  EndpointKeys,
  EndpointShape,
  EndpointTypes,
  ErrorCode,
  MessageBody,
  Scope,
} from '@laratype/contract'
import { appApi } from '../fixtures/app/api'
import type { AppApi } from '../fixtures/app/api'
import type { AccountLocked, EmailTaken, PostLimit } from '../fixtures/app/api/errors'
import users from '../fixtures/app/api/users'
import posts from '../fixtures/app/api/users/[user]/posts'
import usersUser from '../fixtures/app/api/users/[user]/_scope'
import type { Prefix } from '../fixtures/app/api/users/[user]/$types'

// --- defineContract: no name, endpoint keys, endpoint types kept as-is, options and Prefix in the type
expectTypeOf<EndpointKeys<typeof users>>().toEqualTypeOf<'index' | 'show' | 'store' | 'destroy' | 'stats'>()
expectTypeOf(users.show).toEqualTypeOf<
  Endpoint<'get', '/:user', undefined, undefined, undefined, (typeof users.show)['__types']['response'], 200>
>()
expectTypeOf(users).toMatchTypeOf<Contract>()
expectTypeOf<ContractPrefixOf<typeof posts>>().toEqualTypeOf<Prefix>()
expectTypeOf<ContractPrefixOf<typeof users>>().toEqualTypeOf<ContractPrefix>()
// @ts-expect-error the brand is required: a plain record of endpoints is not a contract
expectTypeOf({ show: users.show }).toMatchTypeOf<Contract>()

// --- defineScope: the options, frozen and branded
expectTypeOf(usersUser).toEqualTypeOf<Scope<{ readonly auth: true; readonly authorize: true; readonly throws: readonly [typeof AccountLocked] }>>()
expectTypeOf(usersUser.authorize).toEqualTypeOf<true>()

// --- NoInfer regression inside defineContract (C1 c5afc07): `.response()` last in the chain keeps the 200 default
expectTypeOf(users.index.__types.status).toEqualTypeOf<200>()
expectTypeOf(posts.index.__types.status).toEqualTypeOf<200>()
expectTypeOf(users.store.__types.status).toEqualTypeOf<201>()
const inline = defineContract()({ a: endpoint.get('/a').query(z.object({ q: z.string() })).response(z.string()) })
expectTypeOf(inline.a.__types.status).toEqualTypeOf<200>()

// --- defineApi: flat tree names → nested tree
expectTypeOf(appApi.users.show).toEqualTypeOf<typeof users.show>()
expectTypeOf(appApi.users.posts.store).toEqualTypeOf<typeof posts.store>()
expectTypeOf<keyof typeof appApi & string>().toEqualTypeOf<'users'>()
expectTypeOf<keyof typeof appApi.users & string>().toEqualTypeOf<'index' | 'show' | 'store' | 'destroy' | 'stats' | 'posts'>()

// route names: the folder names plus the endpoint key
expectTypeOf<ApiRouteName<AppApi>>().toEqualTypeOf<
  | 'users.index' | 'users.show' | 'users.store' | 'users.destroy' | 'users.stats'
  | 'users.posts.index' | 'users.posts.store' | 'users.posts.search'
>()
expectTypeOf<ApiEndpoint<AppApi, 'users.posts.store'>>().toEqualTypeOf<typeof posts.store>()
expectTypeOf(apiEndpoint(appApi, 'users.show')).toEqualTypeOf<typeof users.show>()
expectTypeOf(apiEndpoint(appApi, 'users.posts.search')).toEqualTypeOf<typeof posts.search>()
// @ts-expect-error unknown route name
apiEndpoint(appApi, 'users.nope')
// @ts-expect-error a node is not a route
apiEndpoint(appApi, 'users.posts')
expectTypeOf(apiRoutes(appApi)[0]!).toEqualTypeOf<ApiRoute<ApiRouteName<AppApi>>>()

// pure folder nodes (`v1` in `v1.health`) and inline contracts
const health = defineContract()({ check: endpoint.get('/').response(z.object({ ok: z.boolean() })) })
const v1 = defineApi({ 'v1.health': { contract: health, path: '/api/v1/health', scopes: [] } })
expectTypeOf<ApiRouteName<typeof v1>>().toEqualTypeOf<'v1.health.check'>()
expectTypeOf<ApiTypes<typeof v1>['v1']['health']['check']['path']>().toEqualTypeOf<'/api/v1/health'>()

// --- defineApi diagnostics
defineApi({
  // @ts-expect-error defineApi: "users.posts" path must start with its folder prefix "/api/users/:user"
  'users.posts': { contract: posts, path: '/api/posts', scopes: [{ scope: usersUser, dir: 'users/[user]' }] },
})
defineApi({
  // @ts-expect-error defineApi: "users" has an endpoint and a child contract with the same name
  users: { contract: users, path: '/api/users', scopes: [] },
  'users.show': { contract: health, path: '/api/users/show', scopes: [] },
})
// @ts-expect-error defineApi: invalid tree name
defineApi({ 'users..x': { contract: health, path: '/x', scopes: [] } })
// @ts-expect-error entries are { contract, path, scopes: [{ scope, dir }] }
defineApi({ users })
// @ts-expect-error each scope comes with its folder: [{ scope, dir }]
defineApi({ 'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [usersUser] } })

// --- isApiRoot / isApiNode: the root carries its own brand, so a hand-made object of nodes is no root
expectTypeOf(appApi).toMatchTypeOf<{ readonly [API_ROOT]: true }>()
expectTypeOf({ users: appApi.users }).not.toMatchTypeOf<{ readonly [API_ROOT]: true }>()
expectTypeOf(appApi.users).toMatchTypeOf<AnyApiNode>()
expectTypeOf(isApiRoot).guards.toEqualTypeOf<Api>()
expectTypeOf(isApiNode).guards.toEqualTypeOf<AnyApiNode>()
expectTypeOf(isContract).guards.toEqualTypeOf<AnyContract>()
// @ts-expect-error scopes must be scopes
defineApi({ x: { contract: health, path: '/x', scopes: [{ scope: { auth: true }, dir: '' }] } })

// --- ApiTypes / EndpointTypes: schema-free projection
type T = ApiTypes<AppApi>
expectTypeOf<keyof T>().toEqualTypeOf<'users'>()
expectTypeOf<keyof T['users']>().toEqualTypeOf<'index' | 'show' | 'store' | 'destroy' | 'stats' | 'posts'>()
expectTypeOf<keyof T['users']['posts']>().toEqualTypeOf<'index' | 'store' | 'search'>()
expectTypeOf<T['users']['show']['method']>().toEqualTypeOf<'get'>()
// full paths, folder params included
expectTypeOf<T['users']['index']['path']>().toEqualTypeOf<'/api/users'>()
expectTypeOf<T['users']['show']['path']>().toEqualTypeOf<'/api/users/:user'>()
expectTypeOf<T['users']['posts']['index']['path']>().toEqualTypeOf<'/api/users/:user/posts'>()
expectTypeOf<T['users']['posts']['search']['path']>().toEqualTypeOf<'/api/users/:user/posts/search'>()
expectTypeOf<T['users']['show']['params']>().toEqualTypeOf<{ user: string }>()
expectTypeOf<T['users']['posts']['index']['params']>().toEqualTypeOf<{ user: string }>()
expectTypeOf<T['users']['index']['params']>().toEqualTypeOf<{}>()
// inputs use the schema input, the response uses the schema output
expectTypeOf<T['users']['index']['query']>().toEqualTypeOf<{ page?: number | undefined }>()
expectTypeOf<T['users']['store']['body']>().toEqualTypeOf<{ name: string; email: string }>()
expectTypeOf<T['users']['store']['headers']>().toEqualTypeOf<{ 'x-tenant': string }>()
expectTypeOf<T['users']['show']['response']>().toEqualTypeOf<{ id: number; name: string; email: string; createdAt: Date }>()
expectTypeOf<T['users']['show']['query']>().toEqualTypeOf<undefined>()
expectTypeOf<T['users']['destroy']['response']>().toEqualTypeOf<undefined>()
expectTypeOf<T['users']['index']['status']>().toEqualTypeOf<200>()
expectTypeOf<T['users']['store']['status']>().toEqualTypeOf<201>()

// derived errors per endpoint (contract { auth: true, throttle }, scope { auth, authorize, throws }, contract throws)
type Codes<E> = E extends { code: infer C } ? C : never
expectTypeOf<Codes<T['users']['index']['errors']>>().toEqualTypeOf<'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'TOO_MANY_REQUESTS'>()
expectTypeOf<Codes<T['users']['show']['errors']>>().toEqualTypeOf<'NOT_FOUND' | 'UNAUTHORIZED' | 'TOO_MANY_REQUESTS'>()
expectTypeOf<Codes<T['users']['store']['errors']>>().toEqualTypeOf<'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'TOO_MANY_REQUESTS' | 'EMAIL_TAKEN'>()
expectTypeOf<Codes<T['users']['destroy']['errors']>>().toEqualTypeOf<'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS'>()
expectTypeOf<T['users']['stats']['errors']>().toEqualTypeOf<never>()
expectTypeOf<Codes<T['users']['posts']['index']['errors']>>().toEqualTypeOf<
  'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'ACCOUNT_LOCKED' | 'POST_LIMIT'
>()
expectTypeOf<Codes<T['users']['posts']['store']['errors']>>().toEqualTypeOf<
  'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS' | 'ACCOUNT_LOCKED' | 'POST_LIMIT'
>()
expectTypeOf<Codes<T['users']['posts']['search']['errors']>>().toEqualTypeOf<'NOT_FOUND' | 'ACCOUNT_LOCKED' | 'POST_LIMIT'>()
expectTypeOf<Extract<T['users']['store']['errors'], { code: 'EMAIL_TAKEN' }>>().toEqualTypeOf<{
  status: 409
  code: 'EMAIL_TAKEN'
  body: { message: string; email: string }
}>()
expectTypeOf<Extract<T['users']['posts']['store']['errors'], { status: 429 }>['code']>().toEqualTypeOf<'TOO_MANY_REQUESTS' | 'POST_LIMIT'>()
expectTypeOf<ErrorCode<typeof EmailTaken | typeof PostLimit>>().toEqualTypeOf<'EMAIL_TAKEN' | 'POST_LIMIT'>()

// EndpointTypes without a context is the endpoint on its own
expectTypeOf<EndpointTypes<typeof users.show>['path']>().toEqualTypeOf<'/:user'>()
expectTypeOf<EndpointTypes<typeof users.show>['errors']>().toEqualTypeOf<{ status: 404; code: 'NOT_FOUND'; body: MessageBody }>()

// --- ApiShape: self-constraint accepting both the projection and a generated interface
declare function client<A extends ApiShape<A>>(): A
expectTypeOf(client<T>()).toEqualTypeOf<T>()
interface GeneratedApi {
  users: {
    show: {
      method: 'get'
      path: '/api/users/:user'
      params: { user: string }
      query: undefined
      body: undefined
      headers: undefined
      response: { id: number }
      status: 200
      errors: { status: 404; code: 'NOT_FOUND'; body: { message: string } }
    }
    posts: {
      index: {
        method: 'get'
        path: '/api/users/:user/posts'
        params: { user: string }
        query: undefined
        body: undefined
        headers: undefined
        response: { id: number }[]
        status: 200
        errors: never
      }
    }
  }
}
expectTypeOf(client<GeneratedApi>()).toEqualTypeOf<GeneratedApi>()
// @ts-expect-error not an API shape
client<{ users: { show: { method: 'get' } } }>()
// @ts-expect-error errors carry a code
client<{ users: { show: Omit<EndpointShape, 'errors'> & { errors: { status: 404; body: unknown } } } }>()
// why not an index-signature constraint: it rejects interfaces
declare function strictClient<A extends Record<string, Record<string, EndpointShape>>>(): A
// @ts-expect-error Index signature for type 'string' is missing in type 'GeneratedApi'
strictClient<GeneratedApi>()

void defineScope
