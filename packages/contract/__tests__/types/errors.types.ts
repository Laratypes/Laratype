// Type tests: compiled by ../typecheck.test.ts with tsc, so a broken expectation fails `vitest run`.
import { expectTypeOf } from 'vitest'
import { defineError, endpoint, errors } from '@laratype/contract'
import type { ErrorBody, ErrorDef, ErrorResponse, ErrorStatus, MessageBody, ValidationErrorBody } from '@laratype/contract'

// --- defineError: status literal inferred, body defaults to { message }
const teapot = defineError(418, 'TEAPOT')
expectTypeOf(teapot).toEqualTypeOf<ErrorDef<418, MessageBody>>()
expectTypeOf(teapot.status).toEqualTypeOf<418>()
expectTypeOf<ErrorBody<typeof teapot>>().toEqualTypeOf<{ message: string }>()

const quota = defineError<402, { message: string; remaining: number }>(402, 'QUOTA')
expectTypeOf<ErrorStatus<typeof quota>>().toEqualTypeOf<402>()
expectTypeOf<ErrorBody<typeof quota>>().toEqualTypeOf<{ message: string; remaining: number }>()

// --- built-ins
expectTypeOf(errors.unauthorized).toEqualTypeOf<ErrorDef<401, MessageBody>>()
expectTypeOf(errors.forbidden).toEqualTypeOf<ErrorDef<403, MessageBody>>()
expectTypeOf(errors.notFound).toEqualTypeOf<ErrorDef<404, MessageBody>>()
expectTypeOf(errors.conflict).toEqualTypeOf<ErrorDef<409, MessageBody>>()
expectTypeOf(errors.validation).toEqualTypeOf<ErrorDef<422, ValidationErrorBody>>()
expectTypeOf(errors.tooManyRequests).toEqualTypeOf<ErrorDef<429, MessageBody>>()
expectTypeOf<ErrorBody<typeof errors.validation>>().toEqualTypeOf<{ message: string; errors: Record<string, string[]> }>()

// --- wired into the builder: E is the union, ErrorResponse<E> narrows body by status
const show = endpoint.get('/users/:user').errors(errors.notFound, errors.validation).errors(quota)
type E = typeof show.__types.errors
expectTypeOf<ErrorStatus<E>>().toEqualTypeOf<404 | 422 | 402>()
expectTypeOf<ErrorResponse<E>>().toEqualTypeOf<
  | { status: 404; body: MessageBody }
  | { status: 422; body: ValidationErrorBody }
  | { status: 402; body: { message: string; remaining: number } }
>()

declare const res: ErrorResponse<E>
if (res.status === 422) {
  expectTypeOf(res.body).toEqualTypeOf<ValidationErrorBody>()
  expectTypeOf(res.body.errors).toEqualTypeOf<Record<string, string[]>>()
} else if (res.status === 402) {
  expectTypeOf(res.body.remaining).toEqualTypeOf<number>()
} else {
  expectTypeOf(res.status).toEqualTypeOf<404>()
  expectTypeOf(res.body).toEqualTypeOf<MessageBody>()
}

// no errors declared -> nothing to narrow
const bare = endpoint.get('/')
expectTypeOf<ErrorResponse<typeof bare.__types.errors>>().toEqualTypeOf<never>()

// --- negatives
// @ts-expect-error status must be a number
defineError('404', 'NOT_FOUND')
// @ts-expect-error code is required
defineError(404)
// @ts-expect-error explicit status generic must match the argument
defineError<404>(403, 'X')
// @ts-expect-error unknown built-in
errors.badRequest
// @ts-expect-error built-ins are readonly
errors.notFound = teapot
// @ts-expect-error def fields are readonly
errors.notFound.status = 500
// @ts-expect-error validation body has no `issues`
errors.validation.__body?.issues
// @ts-expect-error 418 is not in the declared error union
expectTypeOf<ErrorStatus<E>>().toEqualTypeOf<404 | 422 | 402 | 418>()
