// Stand-in for the generated .laratype/api/index.gen.ts (G1 #133): the only module the FE imports.
// Contracts only: no routes, controllers, models or server packages.
import { defineApi } from '@laratype/contract'
import users from './users'
import usersUser from './users/[user]/_scope'
import usersPosts from './users/[user]/posts'

export const appApi = defineApi({
  users: { contract: users, path: '/api/users', scopes: [] },
  'users.posts': { contract: usersPosts, path: '/api/users/:user/posts', scopes: [{ scope: usersUser, dir: 'users/[user]' }] },
})
export type AppApi = typeof appApi
