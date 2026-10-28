// docs/v1/di.md: Request scope and scope bubbling (D6 #112, proposed).
import { expectTypeOf } from 'vitest'
import { __laratype_deps, Container, Injectable, depsRegistry, token } from '@laratype/core'

export const REQUEST_ID = token<string>('requestId')

// One unit of work per request, closed when the request scope is disposed.
export class UnitOfWork {
  constructor(readonly requestId: string) {}
  async [Symbol.asyncDispose]() { /* commit or roll back */ }
}
__laratype_deps(UnitOfWork, [() => REQUEST_ID], { params: ['requestId'] })

// `@Injectable({ scope: 'request' })` makes an unbound class request-scoped when it is autowired.
@Injectable({ scope: 'request' })
export class Audit {
  readonly entries: string[] = []
}

// A singleton that depends on a request-scoped value bubbles: it is built once per request, with a dev warning.
export class OrderService {
  constructor(readonly uow: UnitOfWork, readonly audit: Audit) {}
}
__laratype_deps(OrderService, [() => UnitOfWork, () => Audit], { params: ['uow', 'audit'] })

export const app = new Container({ deps: depsRegistry })
app.scoped(UnitOfWork) // same as app.bind(UnitOfWork, undefined, { scope: 'request' })
app.singleton(OrderService)

// What RequestKernel does for each request: a request scope with its per-request values. `dispose()` is started once
// the handler settles and is never awaited, so a slow or hung disposer cannot delay or hang the response.
export async function handle(requestId: string) {
  const scope = app.createRequestScope().instance(REQUEST_ID, requestId)
  try {
    const orders = scope.make(OrderService)
    expectTypeOf(orders).toEqualTypeOf<OrderService>()
    return orders.uow === scope.make(UnitOfWork) // true: one UnitOfWork per request
  } finally {
    // Started, never awaited, and its rejection is handled on the promise: a slow or hung disposer cannot delay the
    // response, and a failing one is logged instead of becoming an unhandled rejection
    void scope.dispose().catch((error: unknown) => console.error('disposing the request scope failed', error))
  }
}
