// docs/v1/contract.md: defineContract / defineApi / ApiTypes. Proposed in PR #204 (C5); moves up one level on merge.
import { expectTypeOf } from 'vitest'
import * as z from 'zod'
import { apiEndpoint, apiRoutes, defineApi, defineContract, endpoint, errors, routeName } from '@laratype/contract'
import type { ApiRouteName, ApiTypes } from '@laratype/contract'

const UserDto = z.object({ id: z.number(), name: z.string(), email: z.string().email() })

// app/contracts/users.ts: imports only @laratype/contract and the schema library.
export const users = defineContract('users', {
  index: endpoint.get('/users').query(z.object({ page: z.coerce.number().default(1) })).response(z.array(UserDto)),
  show: endpoint.get('/users/:user').response(UserDto).errors(errors.notFound),
  store: endpoint
    .post('/users')
    .body(z.object({ name: z.string().min(1), email: z.string().email() }))
    .response(UserDto, 201)
    .errors(errors.validation),
})

// app/contracts/index.ts: the only module a FE imports. Keys must equal the contract names.
export const appApi = defineApi({ users })
export type AppApi = typeof appApi

// Route registry names are `<contract>.<endpoint>`.
expectTypeOf<ApiRouteName<AppApi>>().toEqualTypeOf<'users.index' | 'users.show' | 'users.store'>()
expectTypeOf(routeName(users, 'show')).toEqualTypeOf<'users.show'>()
expectTypeOf(apiEndpoint(appApi, 'users.show')).toEqualTypeOf<typeof users.show>()
export const names = apiRoutes(appApi).map(([name]) => name)

// Schema-free projection for the client and `sauf types:generate`: inputs use the schema input, the response its output.
type Api = ApiTypes<AppApi>
expectTypeOf<Api['users']['index']['query']>().toEqualTypeOf<{ page?: number | undefined }>()
expectTypeOf<Api['users']['show']['params']>().toEqualTypeOf<{ user: string }>()
expectTypeOf<Api['users']['store']['status']>().toEqualTypeOf<201>()
expectTypeOf<Api['users']['store']['errors']['status']>().toEqualTypeOf<422>()

// @ts-expect-error the key must match the contract name ("users"), so api.people.show could never disagree with "users.show"
defineApi({ people: users })
