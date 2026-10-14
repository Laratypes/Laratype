// app/api/errors.ts: domain errors, FE-importable (contract package only).
import { defineError } from '@laratype/contract'

export const EmailTaken = defineError(409, 'EMAIL_TAKEN', (email: string) => ({ message: 'The email is taken.', email }))
export const AccountLocked = defineError(403, 'ACCOUNT_LOCKED')
export const PostLimit = defineError(429, 'POST_LIMIT', (limit: number) => ({ message: 'Too many posts.', limit }))
