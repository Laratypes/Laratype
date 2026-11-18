import type { ZodType } from "zod"

export class FormValidation {

  /**
   * The 0.5 `parse()` path. zod 4's `ZodType` defaults its output to `unknown`, so `ZodType<any>` keeps `parse()`'s
   * old `any` and this public type. The import is type-only: a built server does not load zod for it.
   */
  public static validationResult = (schema: ZodType<any>, data: Record<string, any>) => {
    return schema.parse(data)
  }
}
