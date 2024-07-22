import { Context } from "hono"
import { Request } from "express-validator/src/base"
import { getCookie } from "hono/cookie"
import { Schema, checkSchema, matchedData, validationResult } from "express-validator"

export default class FormValidation {

  public static convertContext = async (c: Context): Promise<Request> => {
    return {
      body: {},
      cookies: getCookie(c),
      headers: c.req.raw.headers,
      params: c.req.param() as Record<string, any>,
      query: c.req.queries(),
    }
  }

  // TODO: Write declarations
  public static validationResult = (req: any) => {
    return validationResult(req);
  }

  // TODO: Write declarations
  public static matchedData = (req: any) => {
    return matchedData(req);
  }

  // TODO: Write declarations
  public static checkSchema = (schema: Schema) => {
    return checkSchema(schema);
  }
}