// app/contracts/index.ts: the only module the FE imports. Contracts only: no routes, controllers, models or server packages.
import { defineApi } from '@laratype/contract'
import { users } from './users'
import { posts } from './posts'

export const appApi = defineApi({ users, posts })
export type AppApi = typeof appApi
