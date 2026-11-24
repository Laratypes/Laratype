// docs/v1/http.md › Authorization from the contract (H8 #122, proposed) and auth.md › Policies and gates.
import { Auth, Gate } from '@laratype/auth'
import type { HasPolicy } from '@laratype/auth'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Model } from '@laratype/database'
import { Controller, Route } from '@laratype/http'
import { ServiceProvider } from '@laratype/support'

class User extends Model {
  id!: number
  isAdmin!: boolean
}

export default class Post extends Model {
  id!: number
  userId!: number
}

// The type half of Gate.policy(Post, PostPolicy): a declaration beside the class, nothing added at runtime.
export default interface Post extends HasPolicy<PostPolicy> {}

// A scope policy is a folder guard: before(user, ability, params) receives the resolved bound-model record.
class RootPolicy {
  before(user: User, ability: string, params: { user?: User; post?: Post }) {
    void [ability, params]
    return user.isAdmin ? true : null
  }
}

class UserScopePolicy {
  before(user: User, ability: string, params: { user: User; post?: Post }) {
    void [ability, params]
    return user.isAdmin ? true : null
  }
}

// An endpoint policy is a resource policy: update(user, post) is the same method user.can('update', post) calls.
class PostPolicy {
  viewAny(user: User) {
    return user.isAdmin
  }

  update(user: User, post: Post) {
    return user.id === post.userId
  }
}

// The folder scopes: /api/_scope.ts and /api/users/[user]/_scope.ts.
const root = defineScope()({ auth: true, authorize: true })
const usersUser = defineScope<ContractPrefix<'/api/users/:user', [typeof root]>>()({ authorize: true })

// app/api/users/[user]/posts.ts
const posts = defineContract<ContractPrefix<'/api/users/:user/posts', [typeof root, typeof usersUser]>>()({
  update: endpoint.patch('/:post'),
  // .authorize(false) opts out of the scope's authorize; the contract's auth still applies.
  index: endpoint.get('/').authorize(false),
})

const appApi = defineApi({
  'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [{ scope: root, dir: '' }, { scope: usersUser, dir: 'users/[user]' }] },
})

class PostController extends Controller {
  update() {}
  index() {}
}

// Route.api mounts the policies; the auth guard and the policy chain run on every request whose resolved authorize is true.
export const routes = Route.api(appApi, (r) => [
  r.bind({ user: User }).scope('', { policy: RootPolicy }),
  r.bind({ user: User }).scope('users/[user]', { policy: UserScopePolicy }),
  r.bind({ user: User, post: Post }).contract(posts, PostController, { policy: PostPolicy }),
])

// Register the policy for the service-side checks, as Laravel's Gate::policy does.
export class AuthServiceProvider extends ServiceProvider {
  register() {
    Gate.policy(Post, PostPolicy)
  }
}

// The same PostPolicy.update(user, post) serves the route and a service.
export async function updatePost(post: Post) {
  const authenticated = Auth.user()
  if (!authenticated) return false
  return authenticated.can('update', post)
}
