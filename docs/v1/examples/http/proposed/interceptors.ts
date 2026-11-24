// docs/v1/http.md › Interceptors (H11 #138): generic and endpoint-pinned interceptors around a handler.
import * as z from 'zod'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import type { AnyEndpoint } from '@laratype/contract'
import { Controller, Route, defineInterceptor } from '@laratype/http'
import type { Ctx, Result } from '@laratype/http'

const PostDto = z.object({ id: z.number(), title: z.string() })
const posts = defineContract()({
  index: endpoint.get('/').response(z.object({ items: z.array(PostDto) })),
  show: endpoint.get('/:post').response(PostDto),
})
const appApi = defineApi({ posts: { contract: posts, path: '/api/posts', scopes: [] } })

class PostController extends Controller {
  index() {
    return { items: [] }
  }
  show(ctx: Ctx<typeof posts.show>) {
    return { id: Number(ctx.params.post), title: '  Ada  ' }
  }
}

// Generic: mounts on any endpoint; it can only pass through what next() gives.
const log = defineInterceptor((ctx, next) => {
  const started = Date.now()
  return next().then((value) => {
    console.log(ctx.endpoint.def.method, ctx.endpoint.def.path, Date.now() - started)
    return value
  })
})

// A cache hit needs the visible `as R` cast on the generic form.
const cache = new Map<string, unknown>()
const cached = defineInterceptor(async <R>(ctx: Ctx<AnyEndpoint>, next: () => Promise<R>): Promise<R> => {
  const post = (ctx.params as Record<string, string | undefined>).post
  const key = `${ctx.endpoint.def.path}:${String(post)}`
  const hit = cache.get(key) as R | undefined
  if (hit !== undefined) return hit
  const value = await next()
  cache.set(key, value)
  return value
})

// Pinned: the proof checks the returned value against posts.show's response schema.
const trim = defineInterceptor<typeof posts.show>(async (_ctx, next) => {
  // The handler may also return a 0.5 Response/JsonResource; the cast says this route returns the DTO.
  const value = (await next()) as Result<typeof posts.show>
  return { ...value, title: value.title.trim() }
})

export const routes = Route.api(appApi, (r) => [
  r.interceptor(log).contract(posts, PostController, {
    endpoints: { show: (r) => r.interceptor(cached, trim) },
  }),
])
