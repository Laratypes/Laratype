// docs/v1/auth.md › Policies and gates (A3 #121, proposed).
import { Auth, ForbiddenException, Gate } from '@laratype/auth'
import type { HasPolicy } from '@laratype/auth'
import { Model } from '@laratype/database'
import { ServiceProvider } from '@laratype/support'

class User extends Model {
  id!: number
}

export default class Post extends Model {
  id!: number
  userId!: number
}

// The type half of Gate.policy(Post, PostPolicy): a declaration beside the class, nothing added at runtime.
export default interface Post extends HasPolicy<PostPolicy> {}

// A policy is any class with the abilities as methods and an optional before(); the 0.5 Policy base is not required.
export class PostPolicy {
  before(_user: User, _ability: string): boolean | null {
    return null
  }

  viewAny(_user: User): boolean {
    return true
  }

  update(user: User, post: Post): boolean {
    return user.id === post.userId
  }

  delete(_user: User, _post: Post): Promise<boolean> {
    return Promise.resolve(false)
  }
}

// app/src/providers/AuthServiceProvider.ts: register it once, like Laravel's Gate::policy(Post::class, PostPolicy::class).
export class AuthServiceProvider extends ServiceProvider {
  register() {
    Gate.policy(Post, PostPolicy)
  }
}

// A service: Auth.user() is Authenticated<Register['user']> | null (A1 #119).
export async function updatePost(post: Post) {
  const authenticated = Auth.user()
  if (!authenticated) return false
  // The subject's policy decides, as Laravel's $user->can('update', $post) does.
  if (await authenticated.cannot('update', post)) return false
  await authenticated.can('update', post) // Promise<boolean>
  // Gate.authorize() answers the derived 403 instead of a boolean.
  await Gate.authorize(authenticated.getUser(), 'update', post)
  return true
}

// A gate: an ability with no model of its own. Gate.define() returns the typed value Gate.allows() takes.
export const UpdateUser = Gate.define('update-user', (user: User, target: User) => user.id === target.id)

export async function renameUser(user: User, target: User) {
  if (await Gate.denies(user, UpdateUser, target)) {
    throw new ForbiddenException()
  }
  // A guest denies without the gate running; an unknown ability is a type error.
  return Gate.allows(user, UpdateUser, target)
}
