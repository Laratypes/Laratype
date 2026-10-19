// Copy of the G1 snapshot packages/sauf/__tests__/typegen/__snapshots__/api/index.gen.ts (#133), the module a FE imports as `$api`.
// The contract folder tree of app/api. Import it as `$api`.
import { defineApi } from '@laratype/contract'
import s0 from '../../app/api/_scope'
import s1 from '../../app/api/users/[user]/_scope'
import c0 from '../../app/api/users'
import c1 from '../../app/api/users/[user]/posts'
import c2 from '../../app/api/v1/health/index'

export const appApi = defineApi({
  'users': { contract: c0, path: '/api/users', scopes: [s0], dirs: [''] },
  'users.posts': { contract: c1, path: '/api/users/:user/posts', scopes: [s0, s1], dirs: ['', 'users/[user]'] },
  'v1.health': { contract: c2, path: '/api/v1/health', scopes: [s0], dirs: [''] },
})
export type AppApi = typeof appApi
