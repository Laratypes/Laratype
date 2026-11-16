// docs/v1/http.md › Route names and URLs (H13 #162, proposed).
import { expectTypeOf } from 'vitest'
import * as z from 'zod'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Route, redirect, route } from '@laratype/http'
import type { RouteKeyed } from '@laratype/http'

const posts = defineContract()({
  index: endpoint.get('/').query(z.object({ page: z.number().optional() })),
  show: endpoint.get('/:post'),
})
const appApi = defineApi({ 'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [] } })

class PostController extends Controller {
  index() {}
  show() {}
}

// app/routes/api.ts: the group route() reads names from
export const apiRoutes = Route.api(appApi, (r) => [
  r.contract(posts, PostController),
  r.get('/health', () => 'ok').name('health'),
])

// app/declare/routes.d.ts: the registration, by module augmentation (the config() / auth Register pattern)
declare module '@laratype/http' {
  interface Register {
    routes: typeof apiRoutes
  }
}

/** A model: its static side is database.md › BindableModel, and H14 #163 adds getRouteKey() to the model base. */
class User {
  static readonly primaryKey = 'id'
  static readonly routeKeyName = 'slug'
  constructor(readonly slug: string) {}
  getRouteKey() {
    return this.slug
  }
}

declare const user: User
declare const post: number

// "/api/users/ada/posts?page=2" once user.getRouteKey() is "ada"; relative by default
export const relative = route('users.posts.index', { user }, { query: { page: 2 } })
// "https://app.test/api/users/ada/posts/7" with config('config.url') = "https://app.test"
export const absolute = route('users.posts.show', { user, post }, { absolute: true })
// an ad-hoc route named with .name()
export const health = route('health')

expectTypeOf(relative).toEqualTypeOf<string>()
expectTypeOf<User>().toExtend<RouteKeyed>()

// @ts-expect-error not a route of the tree
route('users.nope')
// @ts-expect-error users.posts.show needs its user and post params
route('users.posts.show')
// @ts-expect-error users.posts.show has no query schema
route('users.posts.show', { user, post }, { query: { page: 2 } })

// Location: "/api/users/ada/posts/7" (relative, like route())
export const login = redirect().route('users.posts.show', { user, post })
// Location: "/health", 301
export const moved = redirect(301).route('health')
