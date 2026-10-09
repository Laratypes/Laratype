// Type tests: compiled by ../typecheck.test.ts with tsc, so a broken expectation fails `vitest run`.
import { expectTypeOf } from 'vitest'
import { endpoint } from '@laratype/contract'
import type { PathParamKeys, PathParams } from '@laratype/contract'

// --- basics
expectTypeOf<PathParams<'/'>>().toEqualTypeOf<{}>()
expectTypeOf<PathParams<''>>().toEqualTypeOf<{}>()
expectTypeOf<PathParams<'/health'>>().toEqualTypeOf<{}>()
expectTypeOf<PathParams<'/users/:user'>>().toEqualTypeOf<{ user: string }>()
expectTypeOf<PathParams<':user'>>().toEqualTypeOf<{ user: string }>()
expectTypeOf<PathParams<'/teams/:team/users/:user'>>().toEqualTypeOf<{ team: string; user: string }>()

// --- optional
expectTypeOf<PathParams<'/users/:user/posts/:post?'>>().toEqualTypeOf<{ user: string; post?: string }>()
expectTypeOf<PathParams<'/:a?/:b?'>>().toEqualTypeOf<{ a?: string; b?: string }>()

// --- trailing slash
expectTypeOf<PathParams<'/users/:user/'>>().toEqualTypeOf<{ user: string }>()
expectTypeOf<PathParams<'/users/:user?/'>>().toEqualTypeOf<{ user?: string }>()
expectTypeOf<PathParams<'/users//:user'>>().toEqualTypeOf<{ user: string }>()

// --- wildcard (no named param, same as Hono)
expectTypeOf<PathParams<'*'>>().toEqualTypeOf<{}>()
expectTypeOf<PathParams<'/files/*'>>().toEqualTypeOf<{}>()
expectTypeOf<PathParams<'/users/:user/*'>>().toEqualTypeOf<{ user: string }>()
expectTypeOf<PathParams<'/wild/*/card/:id'>>().toEqualTypeOf<{ id: string }>()

// --- Hono regex params: braces never leak into the key
expectTypeOf<PathParams<'/posts/:id{[0-9]+}'>>().toEqualTypeOf<{ id: string }>()
expectTypeOf<PathParams<'/posts/:id{[0-9]+}?'>>().toEqualTypeOf<{ id?: string }>()
expectTypeOf<PathParams<'/posts/:date{[0-9]{4}-[0-9]{2}}/:slug{[a-z-]+}'>>().toEqualTypeOf<{ date: string; slug: string }>()
expectTypeOf<PathParams<'/posts/:slug{.+\\.png}'>>().toEqualTypeOf<{ slug: string }>()
expectTypeOf<PathParams<'/files/:path{.+/.+}/raw'>>().toEqualTypeOf<{ path: string }>()
expectTypeOf<PathParams<'/files/:path{a/b/c}/:rev'>>().toEqualTypeOf<{ path: string; rev: string }>()
expectTypeOf<PathParams<'/x/:id{a?}'>>().toEqualTypeOf<{ id: string }>()

// --- mixed
expectTypeOf<PathParams<'/api/:version{v[0-9]+}/users/:user?/files/*'>>().toEqualTypeOf<{ version: string; user?: string }>()

// --- degenerate names add nothing
expectTypeOf<PathParams<'/:'>>().toEqualTypeOf<{}>()
expectTypeOf<PathParams<'/:{[0-9]+}'>>().toEqualTypeOf<{}>()

// --- keys helper and builder integration
expectTypeOf<PathParamKeys<'/teams/:team/users/:user{[0-9]+}?'>>().toEqualTypeOf<'team' | 'user'>()
expectTypeOf<PathParamKeys<'/health'>>().toEqualTypeOf<never>()
expectTypeOf(endpoint.get('/posts/:id{[0-9]+}/:slug?/').__types.params).toEqualTypeOf<{ id: string; slug?: string }>()

// --- negatives
declare const regex: PathParams<'/posts/:id{[0-9]+}'>
// @ts-expect-error the regex pattern is not part of the key
regex['id{[0-9]+}']
declare const optional: PathParams<'/users/:user?'>
// @ts-expect-error the "?" marker is not part of the key
optional['user?']
// @ts-expect-error optional params may be undefined
optional.user.toUpperCase()
declare const wildcard: PathParams<'/files/*'>
// @ts-expect-error wildcards are not named params
wildcard['*']
declare const required: PathParams<'/users/:user'>
// @ts-expect-error unknown key
required.id
// @ts-expect-error required params must be present
const missing: PathParams<'/teams/:team/users/:user'> = { team: 't' }
// @ts-expect-error keys helper excludes the pattern
const badKey: PathParamKeys<'/posts/:id{[0-9]+}'> = 'id{[0-9]+}'
// @ts-expect-error a trailing slash does not create an empty key
const emptyKey: PathParamKeys<'/users/:user/'> = ''
// @ts-expect-error path params are strings
const notNumber: PathParams<'/users/:user'> = { user: 1 }
// @ts-expect-error optional params are not required, but are typed as string
expectTypeOf<PathParams<'/users/:user?'>>().toEqualTypeOf<{ user: string }>()

void missing, badKey, emptyKey, notNumber
