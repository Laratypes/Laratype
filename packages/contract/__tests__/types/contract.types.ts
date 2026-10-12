// Type tests: compiled by ../typecheck.test.ts with tsc, so a broken expectation fails `vitest run`.
import { expectTypeOf } from 'vitest'
import * as z from 'zod'
import { apiEndpoint, apiRoutes, contractName, defineApi, defineContract, endpoint, errors, routeName } from '@laratype/contract'
import type {
  Api,
  ApiEndpoint,
  ApiRouteName,
  ApiShape,
  ApiTypes,
  Contract,
  ContractName,
  ContractRouteName,
  Endpoint,
  EndpointKeys,
  EndpointShape,
  EndpointTypes,
  MessageBody,
  ValidationErrorBody,
} from '@laratype/contract'
import { appApi } from '../fixtures/app/contracts'
import type { AppApi } from '../fixtures/app/contracts'
import { posts } from '../fixtures/app/contracts/posts'
import { users } from '../fixtures/app/contracts/users'

// --- defineContract: literal name brand, endpoint keys, endpoint types kept as-is
expectTypeOf<ContractName<typeof users>>().toEqualTypeOf<'users'>()
expectTypeOf(contractName(users)).toEqualTypeOf<'users'>()
expectTypeOf<EndpointKeys<typeof users>>().toEqualTypeOf<'index' | 'show' | 'store' | 'destroy'>()
expectTypeOf(users.show).toEqualTypeOf<
  Endpoint<'get', '/users/:user', undefined, undefined, undefined, (typeof users.show)['__types']['response'], 200, typeof errors.notFound>
>()
expectTypeOf(users).toMatchTypeOf<Contract<'users'>>()
// @ts-expect-error the brand is required: a plain record of endpoints is not a contract
expectTypeOf({ show: users.show }).toMatchTypeOf<Contract>()

// --- NoInfer regression inside defineContract (C1 c5afc07): `.response()` last in the chain keeps the 200 default
expectTypeOf(users.index.__types.status).toEqualTypeOf<200>()
expectTypeOf(posts.index.__types.status).toEqualTypeOf<200>()
expectTypeOf(users.store.__types.status).toEqualTypeOf<201>()
const inline = defineContract('inline', { a: endpoint.get('/a').query(z.object({ q: z.string() })).response(z.string()) })
expectTypeOf(inline.a.__types.status).toEqualTypeOf<200>()

// --- registry naming: `users.show`
expectTypeOf<ContractRouteName<typeof users>>().toEqualTypeOf<'users.index' | 'users.show' | 'users.store' | 'users.destroy'>()
expectTypeOf(routeName(users, 'show')).toEqualTypeOf<'users.show'>()
// @ts-expect-error unknown endpoint key
routeName(users, 'nope')
expectTypeOf<ApiRouteName<AppApi>>().toEqualTypeOf<
  'users.index' | 'users.show' | 'users.store' | 'users.destroy' | 'posts.index' | 'posts.store'
>()
expectTypeOf<ApiEndpoint<AppApi, 'posts.store'>>().toEqualTypeOf<typeof posts.store>()
expectTypeOf(apiEndpoint(appApi, 'users.show')).toEqualTypeOf<typeof users.show>()
// @ts-expect-error unknown route name
apiEndpoint(appApi, 'users.nope')
expectTypeOf(apiRoutes(appApi)[0]![0]).toEqualTypeOf<ApiRouteName<AppApi>>()

// dotted contract names (`admin.users.show`) resolve on the whole name
const adminUsers = defineContract('admin.users', { show: endpoint.get('/admin/users/:user') })
const adminApi = defineApi({ 'admin.users': adminUsers, users })
expectTypeOf<ApiRouteName<typeof adminApi>>().toEqualTypeOf<'admin.users.show' | ContractRouteName<typeof users>>()
expectTypeOf(apiEndpoint(adminApi, 'admin.users.show')).toEqualTypeOf<typeof adminUsers.show>()

// --- defineApi
expectTypeOf(appApi).toEqualTypeOf<Api<{ readonly users: typeof users; readonly posts: typeof posts }>>()
expectTypeOf(appApi.users.show).toEqualTypeOf<typeof users.show>()
// @ts-expect-error key must match the contract name (`api.people.show` vs registry name `users.show`)
defineApi({ people: users })
// @ts-expect-error values must be contracts
defineApi({ users: { show: users.show } })

// --- ApiTypes / EndpointTypes: schema-free projection
type T = ApiTypes<AppApi>
expectTypeOf<keyof T>().toEqualTypeOf<'users' | 'posts'>()
expectTypeOf<keyof T['users']>().toEqualTypeOf<'index' | 'show' | 'store' | 'destroy'>()
expectTypeOf<T['users']['show']['method']>().toEqualTypeOf<'get'>()
expectTypeOf<T['users']['show']['path']>().toEqualTypeOf<'/users/:user'>()
expectTypeOf<T['users']['show']['params']>().toEqualTypeOf<{ user: string }>()
expectTypeOf<T['posts']['index']['params']>().toEqualTypeOf<{ user: string }>()
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
expectTypeOf<T['users']['index']['errors']>().toEqualTypeOf<never>()
expectTypeOf<T['users']['store']['errors']>().toEqualTypeOf<{ status: 422; body: ValidationErrorBody }>()
expectTypeOf<T['users']['destroy']['errors']>().toEqualTypeOf<{ status: 403; body: MessageBody } | { status: 404; body: MessageBody }>()
expectTypeOf<EndpointTypes<typeof users.show>>().toEqualTypeOf<T['users']['show']>()

// --- ApiShape: self-constraint accepting both the projection and a generated interface
declare function client<A extends ApiShape<A>>(): A
expectTypeOf(client<T>()).toEqualTypeOf<T>()
interface GeneratedApi {
  users: {
    show: {
      method: 'get'
      path: '/users/:user'
      params: { user: string }
      query: undefined
      body: undefined
      headers: undefined
      response: { id: number }
      status: 200
      errors: { status: 404; body: { message: string } }
    }
  }
}
expectTypeOf(client<GeneratedApi>()).toEqualTypeOf<GeneratedApi>()
// @ts-expect-error not an API shape
client<{ users: { show: { method: 'get' } } }>()
// why not an index-signature constraint: it rejects interfaces
declare function strictClient<A extends Record<string, Record<string, EndpointShape>>>(): A
// @ts-expect-error Index signature for type 'string' is missing in type 'GeneratedApi'
strictClient<GeneratedApi>()
