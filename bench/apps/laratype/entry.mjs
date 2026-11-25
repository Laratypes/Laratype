import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { RequestKernel, ResponseKernel, Route } from '@laratype/http'
import {
  BasicController,
  ChainController,
  appApi,
  basic,
  chain,
  m1,
  m2,
  m3,
  scoped,
  ScopedController,
  ScopedService,
} from './app.mjs'

/**
 * The hand-written production entry of phase 1. It is the boot order of the v1 tests (Container -> HTTP_APP ->
 * RequestKernel/ResponseKernel -> Route.api().mount()), not `sauf build` (B4 #128 / B6 #130 are unmerged) and not
 * `examples/basic`. The packages are imported through their exports, i.e. the built `dist` the runner builds first.
 */
const app = new Hono()
const container = new Container({ deps: depsRegistry })
container.instance(HTTP_APP, app)
container.scoped(ScopedService)

/**
 * RequestKernel.resolveRequest() prints one `console.log(method - url)` per request (Request.ts:587-588). Fairness
 * rule: logging is off everywhere, and a stdout write per request would dominate the measurement. This is the only
 * kernel method the bench overrides; the framework opt-out is a follow-up issue.
 */
class BenchRequestKernel extends RequestKernel {
  resolveRequest() {}
}

new BenchRequestKernel(container).boot()
new ResponseKernel(container).boot()

Route.api(appApi, (r) => [
  r.contract(basic, BasicController),
  r.middleware(m1, m2, m3).contract(chain, ChainController),
  r.contract(scoped, ScopedController),
]).mount(app)

app.get('/health', (c) => c.json({ ok: true }))

const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOST ?? '127.0.0.1'

// Node adapter: @hono/node-server, the same `serve()` the 0.5 node entry uses
// (packages/sauf/src/adapters/node/index.ts:5). Bun: Bun.serve, the documented Bun path.
if (typeof Bun !== 'undefined') {
  Bun.serve({ fetch: app.fetch, port, hostname })
} else {
  const { serve } = await import('@hono/node-server')
  serve({ fetch: app.fetch, port, hostname })
}
