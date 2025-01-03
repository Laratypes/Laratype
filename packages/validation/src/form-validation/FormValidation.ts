import { Context } from "hono"
import { ZodType, z } from "zod"

interface requestData {
  params: Record<string, any>,
  query: Record<string, any>,
  body: Record<string, any>
}
export class FormValidation {

  public static convertContext = async (c: Context) => {
    const req = {
      params: {},
      query: {},
      body: {},
    }
    req.params = c.req.param();
    req.query = c.req.queries();
    try {
      req.body = {
        ...req.body,
        ...await c.req.json(),
      }
    }
    catch(e) {}
    try {
      req.body = {
        ...req.body,
        ...await c.req.parseBody(),
      }
    }
    catch(e) {}
    return req satisfies requestData;
  }

  public static validationResult = (schema: ZodType, request: requestData) => {
    return schema.parse({
      ...request.query,
      ...request.body,
      ...request.params,
    })
  }
}