// docs/v1/contract.md: Standard Schema adapter.
import { expectTypeOf } from 'vitest'

// #region validating-a-value
import * as z from 'zod'
import { endpoint, errors, validate, validateSync } from '@laratype/contract'
import type { ValidationErrorBody } from '@laratype/contract'

const StoreBody = z.object({ name: z.string().min(1), address: z.object({ zip: z.string() }) })
// The body schema alone derives the endpoint's 422 (errors.validation).
export const store = endpoint.post('/users').body(StoreBody)

export async function check(input: unknown): Promise<ValidationErrorBody | { name: string }> {
  // Works with any Standard Schema (zod 4.6.6+, valibot, arktype). The value type comes from the schema output.
  // (The router validates with the untyped runtime slot `store.def.body`.)
  const result = await validate(StoreBody, input)
  if (result.ok) {
    return result.value // { name: string; address: { zip: string } }
  }
  // errors: dot path -> messages, e.g. { "address.zip": ["Required"] }: the 422 body shape.
  return errors.validation(result.errors).body
}

// Sync variant: throws a TypeError when the schema is async.
const Page = z.object({ page: z.coerce.number<number>().default(1) })
export const page = validateSync(Page, { page: '2' })
// page.value.page: number, once page.ok is true
// #endregion validating-a-value

// Type checks, outside the guide region.
type CheckResult = Awaited<ReturnType<typeof validate<typeof StoreBody>>>
expectTypeOf<Extract<CheckResult, { ok: true }>['value']>().toEqualTypeOf<{ name: string; address: { zip: string } }>()
if (page.ok) expectTypeOf(page.value.page).toEqualTypeOf<number>()
