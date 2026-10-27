// Type tests: compiled by ../typecheck.test.ts with tsc, so a broken expectation fails `vitest run`.
import { expectTypeOf } from 'vitest'
import { ContractError, defineError, endpoint, errors, isContractError } from '@laratype/contract'
import type { ErrorBag, ErrorBody, ErrorCode, ErrorDef, ErrorResponse, ErrorStatus, MessageBody, ValidationErrorBody } from '@laratype/contract'

// --- defineError: status and code literals inferred, body defaults to { message }
const teapot = defineError(418, 'TEAPOT')
expectTypeOf(teapot).toEqualTypeOf<ErrorDef<418, 'TEAPOT', MessageBody, [message?: string]>>()
expectTypeOf(teapot.status).toEqualTypeOf<418>()
expectTypeOf(teapot.code).toEqualTypeOf<'TEAPOT'>()
expectTypeOf<ErrorBody<typeof teapot>>().toEqualTypeOf<{ message: string }>()
expectTypeOf(teapot()).toEqualTypeOf<ContractError<418, 'TEAPOT', MessageBody>>()
expectTypeOf(teapot).parameters.toEqualTypeOf<[message?: string]>()

// a body factory types the body and the factory's arguments
const EmailTaken = defineError(409, 'EMAIL_TAKEN', (email: string) => ({ email }))
expectTypeOf<ErrorStatus<typeof EmailTaken>>().toEqualTypeOf<409>()
expectTypeOf<ErrorCode<typeof EmailTaken>>().toEqualTypeOf<'EMAIL_TAKEN'>()
expectTypeOf<ErrorBody<typeof EmailTaken>>().toEqualTypeOf<{ email: string }>()
expectTypeOf(EmailTaken).parameters.toEqualTypeOf<[email: string]>()
expectTypeOf(EmailTaken('a@b.c').body).toEqualTypeOf<{ email: string }>()
expectTypeOf(EmailTaken('a@b.c')).toMatchTypeOf<Error>()

// --- .is() narrows an unknown catch value by code
declare const caught: unknown
if (EmailTaken.is(caught)) {
  expectTypeOf(caught).toEqualTypeOf<ContractError<409, 'EMAIL_TAKEN', { email: string }>>()
  expectTypeOf(caught.body.email).toEqualTypeOf<string>()
  expectTypeOf(caught.code).toEqualTypeOf<'EMAIL_TAKEN'>()
}
if (errors.validation.is(caught)) {
  expectTypeOf(caught.body).toEqualTypeOf<ValidationErrorBody>()
}

// --- isContractError narrows to a ContractError of any def
if (isContractError(caught)) {
  expectTypeOf(caught).toEqualTypeOf<ContractError<number, string, object>>()
  expectTypeOf(caught.status).toEqualTypeOf<number>()
  expectTypeOf(caught.code).toEqualTypeOf<string>()
  expectTypeOf(caught.body).toEqualTypeOf<object>()
}

// --- built-ins: the errors the framework derives
expectTypeOf(errors.unauthorized).toEqualTypeOf<ErrorDef<401, 'UNAUTHORIZED', MessageBody, [message?: string]>>()
expectTypeOf(errors.forbidden).toEqualTypeOf<ErrorDef<403, 'FORBIDDEN', MessageBody, [message?: string]>>()
expectTypeOf(errors.notFound).toEqualTypeOf<ErrorDef<404, 'NOT_FOUND', MessageBody, [message?: string]>>()
expectTypeOf(errors.validation).toEqualTypeOf<ErrorDef<422, 'VALIDATION_ERROR', ValidationErrorBody, [errors: ErrorBag, message?: string]>>()
expectTypeOf(errors.tooManyRequests).toEqualTypeOf<ErrorDef<429, 'TOO_MANY_REQUESTS', MessageBody, [message?: string]>>()
expectTypeOf<ErrorBody<typeof errors.validation>>().toEqualTypeOf<{ message: string; errors: Record<string, string[]> }>()

// --- wired into the builder: ErrorResponse narrows by code (two errors may share a status)
const NotVerified = defineError(403, 'EMAIL_NOT_VERIFIED', () => ({ message: 'Verify your email.', resend: '/verify' }))
const show = endpoint.get('/x').throws(errors.forbidden, NotVerified).throws(EmailTaken)
type E = typeof show.__types.throws
expectTypeOf<ErrorStatus<E>>().toEqualTypeOf<403 | 409>()
expectTypeOf<ErrorResponse<E>>().toEqualTypeOf<
  | { status: 403; code: 'FORBIDDEN'; body: MessageBody }
  | { status: 403; code: 'EMAIL_NOT_VERIFIED'; body: { message: string; resend: string } }
  | { status: 409; code: 'EMAIL_TAKEN'; body: { email: string } }
>()

declare const res: ErrorResponse<E>
if (res.code === 'EMAIL_NOT_VERIFIED') {
  expectTypeOf(res.body.resend).toEqualTypeOf<string>()
} else if (res.status === 403) {
  expectTypeOf(res.code).toEqualTypeOf<'FORBIDDEN'>()
} else {
  expectTypeOf(res.body).toEqualTypeOf<{ email: string }>()
}

// no throws declared -> nothing to narrow
const bare = endpoint.get('/')
expectTypeOf<ErrorResponse<typeof bare.__types.throws>>().toEqualTypeOf<never>()

// --- negatives
// @ts-expect-error status must be a number
defineError('404', 'NOT_FOUND')
// @ts-expect-error code is required
defineError(404)
// @ts-expect-error the body factory must be a function
defineError(404, 'X', { message: 'x' })
// @ts-expect-error the factory arguments are typed
EmailTaken(42)
// The wire format is { code, ...body }: a body is a plain object without its own code (CL2 #110)
// @ts-expect-error the body must not have its own code key
defineError(409, 'X', () => ({ code: 'Y', message: 'x' }))
// @ts-expect-error not even an optional one
defineError(409, 'X', (): { message: string; code?: string } => ({ message: 'x' }))
// @ts-expect-error the body must be an object: a string
defineError(409, 'X', () => 'taken')
// @ts-expect-error a number
defineError(409, 'X', () => 42)
// @ts-expect-error null
defineError(409, 'X', () => null)
// @ts-expect-error an array
defineError(409, 'X', () => ['a'])
// a union of objects is fine, and so is a key that only contains "code"
expectTypeOf(defineError(409, 'X', (n: number) => (n ? { a: 1 } : { b: 'x', errorCode: 'E' }))).toBeFunction()
// an index signature has no literal "code" key: accepted
expectTypeOf(defineError(409, 'X', (): Record<string, string> => ({ field: 'taken' }))).toBeFunction()
// any is left to the runtime check
expectTypeOf(defineError(409, 'X', (): any => ({ message: 'x' }))).toBeFunction()
// @ts-expect-error a function body
defineError(409, 'X', () => () => 1)
// @ts-expect-error one union member with its own code is enough
defineError(409, 'X', (n: number) => (n ? { message: 'x' } : { code: 'Y' }))
// @ts-expect-error a union with a non-object member
defineError(409, 'X', (n: number) => (n ? { message: 'x' } : 'x'))
// @ts-expect-error `conflict` was removed: a conflict is a domain error (defineError(409, ...))
errors.conflict
// @ts-expect-error built-ins are readonly
errors.notFound = teapot
// @ts-expect-error def fields are readonly
errors.notFound.status = 500
// @ts-expect-error validation body has no `issues`
errors.validation([] as never).body.issues
// @ts-expect-error 418 is not in the declared error union
expectTypeOf<ErrorStatus<E>>().toEqualTypeOf<403 | 409 | 418>()
// an error status is 400-599: a 2xx or 3xx error could never be classified as a failure
// @ts-expect-error a 2xx error status
defineError(200, 'X')
// @ts-expect-error a 3xx error status
defineError(302, 'X')
expectTypeOf(defineError(599, 'X').status).toEqualTypeOf<599>()
