import * as z from 'zod'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, defineMiddleware } from '@laratype/http'
import { __laratype_deps } from '@laratype/core'
import { userInput } from '../../shared/schemas.mjs'

const messageOut = z.object({ message: z.string() })
const userOut = z.object({ id: z.string() })
const createdOut = z.object({ id: z.number(), name: z.string(), email: z.string() })
const chainOut = z.object({ m1: z.number(), m2: z.number(), m3: z.number() })
const scopedOut = z.object({ scoped: z.number() })

/**
 * The v1 contract of the benchmark. URLs come from the API tree below; one endpoint key per route.
 * `create` uses the shared Zod schema as the endpoint body slot (Standard Schema), so the 422 comes from the
 * framework's own validation pipeline, not from the handler.
 */
export const basic = defineContract()({
  json: endpoint.get('/json').response(messageOut),
  user: endpoint.get('/users/:id').response(userOut),
  create: endpoint.post('/users').body(userInput).response(createdOut, 201),
})

export const chain = defineContract()({
  index: endpoint.get('/').response(chainOut),
})

export const scoped = defineContract()({
  index: endpoint.get('/').response(scopedOut),
})

export const appApi = defineApi({
  basic: { contract: basic, path: '/api', scopes: [] },
  chain: { contract: chain, path: '/api/chain', scopes: [] },
  scoped: { contract: scoped, path: '/api/scoped', scopes: [] },
})

export class BasicController extends Controller {
  json() {
    return { message: 'Hello, World!' }
  }

  user({ params }) {
    return { id: params.id }
  }

  create({ body }) {
    return { id: 1, name: body.name, email: body.email }
  }
}

export class ChainController extends Controller {
  index({ m1, m2, m3 }) {
    return { m1, m2, m3 }
  }
}

/** Request-scoped (D6 #112): the request scope builds it once and disposes it after the response. */
export class ScopedService {
  constructor() {
    this.hits = 0
  }

  touch() {
    return ++this.hits
  }
}

export class ScopedController extends Controller {
  constructor(service) {
    super()
    this.service = service
  }

  index() {
    return { scoped: this.service.touch() }
  }
}

// What the DI transform emits for the constructor above; no transform runs on a hand-written entry. This is the
// only metadata the app needs: the three middlewares and the basic controller are zero-arg or extension-only.
__laratype_deps(ScopedController, [() => ScopedService], { params: ['service'] })

// Typed middleware (H6 #117): each passes one context key to the handler's ctx; three run for /api/chain only.
export const m1 = defineMiddleware((_request, next) => next({ m1: 1 }))
export const m2 = defineMiddleware((_request, next) => next({ m2: 1 }))
export const m3 = defineMiddleware((_request, next) => next({ m3: 1 }))
