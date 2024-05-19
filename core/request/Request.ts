import { Context } from "hono";
import { convertContext } from "hono-validation";
import { Schema, checkSchema, matchedData, validationResult } from "express-validator"

export default class Request {

  constructor() {
  }

  protected async process(c: Context) {
    const req = await convertContext(c)
    await this.handle().run(req)
    return req;
  }

  public async validate(c: Context) {
    const request = await this.process(c)
    const result = validationResult(request);
    return {
      isError: !result.isEmpty(),
      matchedData: matchedData(request),
      errors: result.array(),
    }
  }

  public rules(): Schema {
    return {}
  }

  protected handle() {
    return checkSchema(this.rules())
  }

  public invoke(c: Context) {
    return this.handle()
  }
}