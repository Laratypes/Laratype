// app/api/users/[user]/_scope.ts: every contract below gets 401, 403 and ACCOUNT_LOCKED.
import { defineScope } from '@laratype/contract'
import { AccountLocked } from '../../errors'
import type { ScopePrefix } from './$types'

export default defineScope<ScopePrefix>()({ auth: true, authorize: true, throws: [AccountLocked] })
