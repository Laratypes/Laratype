// docs/v1/auth.md › Authentication from the contract (A2 #120, proposed).
import { Model } from '@laratype/database'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Route } from '@laratype/http'
import type { Ctx } from '@laratype/http'
import { auth } from '@laratype/auth'

class User extends Model {
  id!: number
  email!: string
}

class Admin extends User {
  role!: 'admin'
}

// The app registers its user and guards once, by module augmentation: a guard is `true` (the app's user) or its own
// `{ user }`. The contract reads the same names, without importing @laratype/auth.
declare module '@laratype/auth' {
  interface Register {
    user: User
    guards: {
      web: true
      api: true
      admin: { user: Admin }
    }
  }
}

const posts = defineContract()({
  index: endpoint.get('/'),
  // The nearest auth level wins: this endpoint uses admin, the contract's default is web.
  destroy: endpoint.delete('/:post').auth('admin'),
  // `.public()` opts out of the contract's auth.
  show: endpoint.get('/:post').public(),
}, { auth: true })

const appApi = defineApi({
  posts: { contract: posts, path: '/api/posts', scopes: [] },
})

class PostController extends Controller {
  // ctx.user is the app's User for auth: true
  async index({ user }: Ctx<typeof posts.index, { user: User }>) {
    void user
  }

  // ctx.user is Admin for auth: 'admin'
  async destroy({ user }: Ctx<typeof posts.destroy, { user: Admin }>) {
    void user.role
  }

  // no auth: no user in the ctx
  async show() {
    return null
  }
}

// Route.api applies the guard itself: no `.middleware(auth())` on an API route. A route whose contract declares auth
// fails mount() when @laratype/auth is not imported.
export const routes = Route.api(appApi, (r) => [r.contract(posts, PostController)])

// The same middleware serves an ad-hoc route or a manual RequestKernel.handle({ middleware: [auth('api')] }).
export const publicRoute = Route.api(defineApi({}), (r) => [
  r.middleware(auth('api')).get('/health', () => ({ ok: true })),
])
