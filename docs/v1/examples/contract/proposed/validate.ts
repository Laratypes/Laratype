// docs/v1/contract.md: Standard Schema adapter. Proposed in PR #205 (C3); moves up one level on merge.
import { expectTypeOf } from 'vitest'
import * as z from 'zod'
import { endpoint, errors, validate, validateSync } from '@laratype/contract'
import type { ValidationErrorBody } from '@laratype/contract'

const StoreBody = z.object({ name: z.string().min(1), address: z.object({ zip: z.string() }) })
export const store = endpoint.post('/users').body(StoreBody).errors(errors.validation)

export async function check(input: unknown): Promise<ValidationErrorBody | { name: string }> {
  // Works with any Standard Schema (zod 3.25+, valibot, arktype). The value type comes from the schema output.
  // (The router validates with the untyped runtime slot `store.def.body`.)
  const result = await validate(StoreBody, input)
  if (result.ok) {
    expectTypeOf(result.value).toEqualTypeOf<{ name: string; address: { zip: string } }>()
    return result.value
  }
  // errors: dot path -> messages, e.g. { "address.zip": ["Required"] }: the 422 body shape.
  return { message: 'The given data was invalid.', errors: result.errors }
}

// Sync variant: throws a TypeError when the schema is async.
const Page = z.object({ page: z.coerce.number().default(1) })
export const page = validateSync(Page, { page: '2' })
if (page.ok) expectTypeOf(page.value.page).toEqualTypeOf<number>()
