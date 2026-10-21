// H24 #275: only a real validation failure answers 422; any other error thrown while validating is a generic 500
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { Controller, Request as LaratypeRequest, RequestKernel, ResponseKernel } from '../../src/index'

/** An app booted like `sauf dev`: RequestKernel validates the route's request class, ResponseKernel handles errors. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  return app
}

class Users extends Controller { store() { return { created: true } } }

/** POSTs `body` as JSON to a route whose request class has the given rules. */
const post = async (rules: () => unknown, body: object) => {
  class UserRequest extends LaratypeRequest { rules() { return rules() as never } }
  const app = bootApp()
  app.post('/users', RequestKernel.handle({ method: 'post', path: '/users', request: UserRequest, controller: [Users, 'store'] }))
  return app.request('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

let errors: ReturnType<typeof vi.spyOn>

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {}
})

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
}

afterEach(() => {
  vi.restoreAllMocks()
})

const secret = () => new AggregateError([new Error('db at 10.0.0.7 refused'), new Error('pool exhausted')], 'secret detail')

const expectGeneric500 = async (response: Response) => {
  expect(response.status).toBe(500)
  const text = await response.text()
  expect(JSON.parse(text)).toEqual({ message: 'Server Error' })
  for (const hidden of ['errors', 'secret detail', '10.0.0.7', 'pool exhausted']) expect(text).not.toContain(hidden)
}

describe('validation errors', () => {
  it('a validator failure answers 422 with its field errors', async () => {
    quiet()
    const response = await post(() => z.object({ email: z.string().email(), name: z.string() }), { email: 'nope' })
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.code).toBe('VALIDATION')
    expect(body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['email'] }),
      expect.objectContaining({ path: ['name'] }),
    ]))
    // valid input reaches the controller
    expect(await (await post(() => z.object({ name: z.string() }), { name: 'ada' })).json()).toEqual({ created: true })
  })

  it('an AggregateError thrown by a refinement is a generic 500, logged, with nothing of it in the body', async () => {
    quiet()
    const failure = secret()
    const rules = () => z.object({ name: z.string() }).superRefine(() => { throw failure })
    await expectGeneric500(await post(rules, { name: 'ada' }))
    expect(errors).toHaveBeenCalledWith(failure)
    // a transform too
    await expectGeneric500(await post(() => z.object({ name: z.string() }).transform(() => { throw secret() }), { name: 'ada' }))
  })

  it('an error from rules() is a 500, not a 422', async () => {
    quiet()
    const failure = secret()
    await expectGeneric500(await post(() => { throw failure }, { name: 'ada' }))
    expect(errors).toHaveBeenCalledWith(failure)
    // even a ZodError from rules() itself (building the schema), which is not a failure of the input
    await expectGeneric500(await post(() => { z.string().parse(1) }, { name: 'ada' }))
  })

  it('a ZodError from another copy of zod is still a validation failure (told by its shape)', async () => {
    quiet()
    // what `instanceof ZodError` misses: an error of the same shape from a second zod
    const foreign = { name: 'ZodError', message: 'invalid', issues: [{ path: ['email'], message: 'Invalid email', code: 'invalid_string' }] }
    const schema = { parse: () => { throw foreign } }
    const response = await post(() => schema, { email: 'nope' })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual(foreign.issues)
  })
})
