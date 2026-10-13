// app/api/users/[user]/_scope.ts: everything under users/[user] needs a policy.
import { defineScope } from '@laratype/contract'
import { AccountLocked } from '../../_errors'
import type { ScopePrefix } from './$types'

export default defineScope<ScopePrefix>()({ auth: true, authorize: true, throws: [AccountLocked] })
