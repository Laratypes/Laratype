// app/api/_errors.ts: domain errors. Private ("_"), so the scan skips it.
import { defineError } from '@laratype/contract'

export const EmailTaken = defineError(409, 'EMAIL_TAKEN', (email: string) => ({ message: 'The email is taken.', email }))
export const AccountLocked = defineError(403, 'ACCOUNT_LOCKED')
/** The same code as the derived 404, at another status: the manifest carries both pairs (CL8 #259). */
export const NotFoundGone = defineError(410, 'NOT_FOUND')
