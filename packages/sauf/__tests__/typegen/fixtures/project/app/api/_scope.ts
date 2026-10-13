// app/api/_scope.ts: every contract gets the rate limit.
import { defineScope } from '@laratype/contract'
import type { ScopePrefix } from './$types'

export default defineScope<ScopePrefix>()({ throttle: { limit: 100, per: '1m' } })
