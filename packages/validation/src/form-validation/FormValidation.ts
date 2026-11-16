import { type Context } from "@laratype/support"
import type { ZodType } from "zod"

export class FormValidation {

  // zod 4's `ZodType` defaults its output to `unknown`: `ZodType<any>` keeps `parse()`'s old `any`, so this 0.5
  // path keeps its public type. The import is type-only, so a built server does not load zod for it.
  public static validationResult = (schema: ZodType<any>, data: Record<string, any>) => {
    return schema.parse(data)
  }
}
