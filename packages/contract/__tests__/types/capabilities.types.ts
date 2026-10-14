// Type tests: compiled by ../typecheck.test.ts with tsc, so a broken expectation fails `vitest run`.
import { expectTypeOf } from 'vitest'
import * as z from 'zod'
import { defineContract, defineError, defineScope, endpoint, errors } from '@laratype/contract'
import type { AnyEndpoint, ContractPrefix, EndpointErrors, EndpointTypes, ErrorCode, ResolvedAuth } from '@laratype/contract'

// App guard registry (A1 #119 fills it from @laratype/auth later): augmenting it types `auth: '<guard>'`.
declare module '@laratype/contract' {
  interface GuardRegistry {
    api: true
    admin: true
  }
}

type Codes<E extends AnyEndpoint> = ErrorCode<EndpointErrors<E>>
const Body = z.object({ name: z.string() })

// --- each derived error, one capability at a time (no context: a root-level endpoint)
expectTypeOf<Codes<ReturnType<typeof endpoint.get<'/health'>>>>().toEqualTypeOf<never>()
const q = endpoint.get('/').query(Body)
expectTypeOf<Codes<typeof q>>().toEqualTypeOf<'VALIDATION_ERROR'>()
const b = endpoint.post('/').body(Body)
expectTypeOf<Codes<typeof b>>().toEqualTypeOf<'VALIDATION_ERROR'>()
const h = endpoint.get('/').headers(z.object({ 'x-tenant': z.string() }))
expectTypeOf<Codes<typeof h>>().toEqualTypeOf<'VALIDATION_ERROR'>()
const p = endpoint.get('/:user')
expectTypeOf<Codes<typeof p>>().toEqualTypeOf<'NOT_FOUND'>()
const opt = endpoint.get('/posts/:id{[0-9]+}?')
expectTypeOf<Codes<typeof opt>>().toEqualTypeOf<'NOT_FOUND'>()
const a = endpoint.get('/').auth()
expectTypeOf<Codes<typeof a>>().toEqualTypeOf<'UNAUTHORIZED'>()
const az = endpoint.get('/').auth().authorize()
expectTypeOf<Codes<typeof az>>().toEqualTypeOf<'UNAUTHORIZED' | 'FORBIDDEN'>()
const t = endpoint.get('/').throttle({ limit: 60, per: '1m' })
expectTypeOf<Codes<typeof t>>().toEqualTypeOf<'TOO_MANY_REQUESTS'>()
// the response schema and a wildcard add nothing
const r = endpoint.get('/files/*').response(Body)
expectTypeOf<Codes<typeof r>>().toEqualTypeOf<never>()

// --- folder context: Prefix path params (404), scopes (401/403/429/throws), contract options
const AccountLocked = defineError(403, 'ACCOUNT_LOCKED')
const EmailTaken = defineError(409, 'EMAIL_TAKEN', (email: string) => ({ email }))
const QuotaExceeded = defineError(402, 'QUOTA_EXCEEDED')

const outer = defineScope()({ auth: 'api', throttle: { limit: 100, per: 60 }, throws: [AccountLocked] })
type InnerPrefix = ContractPrefix<'/api/teams/:team', [typeof outer]>
const inner = defineScope<InnerPrefix>()({ authorize: true })
type Prefix = ContractPrefix<'/api/teams/:team', [typeof outer, typeof inner]>

const members = defineContract<Prefix>()({
  index: endpoint.get('/'),
  store: endpoint.post('/').body(Body).throws(EmailTaken),
  open: endpoint.get('/open').public().authorize(false),
  free: endpoint.get('/free').authorize(false).throttle(false),
  admin: endpoint.get('/admin').auth('admin'),
}, { throws: [QuotaExceeded] })

type Ctx = { path: '/api/teams/:team'; scopes: [typeof outer, typeof inner]; options: { readonly throws: readonly [typeof QuotaExceeded] } }
type C<K extends keyof typeof members & string> = ErrorCode<EndpointErrors<(typeof members)[K], Ctx>>

// folder param → 404, scope auth → 401, scope authorize → 403, scope throttle → 429, throws from every level
expectTypeOf<C<'index'>>().toEqualTypeOf<'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS' | 'ACCOUNT_LOCKED' | 'QUOTA_EXCEEDED'>()
// throws: union of scope → contract → endpoint; body schema → 422
expectTypeOf<C<'store'>>().toEqualTypeOf<
  'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS' | 'ACCOUNT_LOCKED' | 'QUOTA_EXCEEDED' | 'EMAIL_TAKEN'
>()
// .public() removes 401; .authorize(false) removes 403 (and allows .public() under an authorize scope); throws stay
expectTypeOf<C<'open'>>().toEqualTypeOf<'NOT_FOUND' | 'TOO_MANY_REQUESTS' | 'ACCOUNT_LOCKED' | 'QUOTA_EXCEEDED'>()
// .throttle(false) removes 429
expectTypeOf<C<'free'>>().toEqualTypeOf<'NOT_FOUND' | 'UNAUTHORIZED' | 'ACCOUNT_LOCKED' | 'QUOTA_EXCEEDED'>()
// auth: the nearest level wins
expectTypeOf<ResolvedAuth<(typeof members)['index'], Ctx>>().toEqualTypeOf<'api'>()
expectTypeOf<ResolvedAuth<(typeof members)['admin'], Ctx>>().toEqualTypeOf<'admin'>()
expectTypeOf<ResolvedAuth<(typeof members)['open'], Ctx>>().toEqualTypeOf<false>()

// the projection carries the same union, narrowable by code
type Store = EndpointTypes<(typeof members)['store'], Ctx>
expectTypeOf<Store['path']>().toEqualTypeOf<'/api/teams/:team'>()
expectTypeOf<Store['params']>().toEqualTypeOf<{ team: string }>()
declare const err: Store['errors']
if (err.code === 'EMAIL_TAKEN') expectTypeOf(err.body).toEqualTypeOf<{ email: string }>()
if (err.code === 'VALIDATION_ERROR') expectTypeOf(err.body.errors).toEqualTypeOf<Record<string, string[]>>()
if (err.status === 403) expectTypeOf(err.code).toEqualTypeOf<'FORBIDDEN' | 'ACCOUNT_LOCKED'>()

// a built-in in throws (a search with no path param whose service throws notFound)
const search = defineContract()({ find: endpoint.get('/search').query(Body).throws(errors.notFound) })
expectTypeOf<ErrorCode<EndpointErrors<typeof search.find>>>().toEqualTypeOf<'VALIDATION_ERROR' | 'NOT_FOUND'>()

// contract-level auth and throttle, endpoint-level opt-outs
const pub = defineContract()({
  me: endpoint.get('/me'),
  login: endpoint.post('/login').body(Body).public().throttle({ limit: 5, per: '1m' }),
  ping: endpoint.get('/ping').throttle(false),
}, { auth: true, throttle: { limit: 60, per: '1m' } })
type PubCtx = { path: ''; scopes: []; options: { readonly auth: true; readonly throttle: { readonly limit: 60; readonly per: '1m' } } }
expectTypeOf<ErrorCode<EndpointErrors<typeof pub.me, PubCtx>>>().toEqualTypeOf<'UNAUTHORIZED' | 'TOO_MANY_REQUESTS'>()
expectTypeOf<ErrorCode<EndpointErrors<typeof pub.login, PubCtx>>>().toEqualTypeOf<'VALIDATION_ERROR' | 'TOO_MANY_REQUESTS'>()
expectTypeOf<ErrorCode<EndpointErrors<typeof pub.ping, PubCtx>>>().toEqualTypeOf<'UNAUTHORIZED'>()

// --- compile errors
defineContract<Prefix>()({
  // @ts-expect-error .public() under a scope with authorize: add .authorize(false) or move the contract out of the scope
  stats: endpoint.get('/stats').public(),
})
defineContract()({
  // @ts-expect-error .authorize() needs auth on the endpoint, its contract or a scope
  destroy: endpoint.delete('/:id').authorize(),
})
defineContract()({
  // @ts-expect-error .authorize() needs auth, but the endpoint is .public()
  destroy: endpoint.delete('/:id').public().authorize(),
}, { auth: true })
// authorize with auth at the contract level, or on the endpoint, is fine
defineContract()({ destroy: endpoint.delete('/:id').authorize() }, { auth: true })
defineContract()({ destroy: endpoint.delete('/:id').auth('api').authorize() })

// @ts-expect-error defineScope: authorize needs auth in this scope or an outer one
defineScope()({ authorize: true })
defineScope<ContractPrefix<'/api', [typeof outer]>>()({ authorize: true })
defineScope()({ auth: true, authorize: true })

// @ts-expect-error unknown guard
defineContract()({ x: endpoint.get('/') }, { auth: 'web' })
// @ts-expect-error contracts have no authorize level (scopes and endpoints only)
defineContract()({ x: endpoint.get('/') }, { authorize: true })
// @ts-expect-error opt-outs exist only on endpoints
defineContract()({ x: endpoint.get('/') }, { auth: false })
// @ts-expect-error opt-outs exist only on endpoints
defineScope()({ throttle: false })
// @ts-expect-error throws takes error factories
defineScope()({ throws: [{ status: 403, code: 'X' }] })
