import { Context } from "hono"
import { ZodType, z } from "zod"

export class FormValidation {

  public static validationResult = (schema: ZodType, data: Record<string, any>) => {
    return schema.parse(data)
  }
}