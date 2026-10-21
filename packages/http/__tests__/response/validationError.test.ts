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

  it('a throwing refinement runs once (zod runs safeParseAsync, not its validate, which re-runs the schema)', async () => {
    quiet()
    let calls = 0
    const rules = () => z.object({ name: z.string() }).superRefine(() => { calls++; throw secret() })
    await expectGeneric500(await post(rules, { name: 'ada' }))
    expect(calls).toBe(1)
  })

  it('a request class that does not override rules() is not validated: validated() keeps its default', async () => {
    quiet()
    let validated: unknown
    class Plain extends LaratypeRequest {}
    class Reader extends Controller { store(req: LaratypeRequest) { validated = req.validated(); return { created: true } } }
    const app = bootApp()
    app.post('/plain', RequestKernel.handle({ method: 'post', path: '/plain', request: Plain, controller: [Reader, 'store'] }))
    const response = await app.request('/plain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"ada"}' })
    // reached the controller (201: the 0.5 status guess for store)
    expect(response.status).toBe(201)
    expect(validated).toEqual({})
  })

  it('another Standard Schema library answers 422 with { path, message } only, never the issue input', async () => {
    quiet()
    const issues = [{ message: 'Too short', path: [{ key: 'password', input: { password: 'hunter2' } }], input: 'hunter2', received: '"hunter2"' }]
    const valibotLike = { '~standard': { version: 1, vendor: 'valibot', validate: () => ({ issues }) } }
    const response = await post(() => valibotLike, { password: 'hunter2' })
    expect(response.status).toBe(422)
    const text = await response.text()
    expect(JSON.parse(text).errors).toEqual([{ path: ['password'], message: 'Too short' }])
    expect(text).not.toContain('hunter2')
  })

  it('an error from rules() is a 500, not a 422', async () => {
    quiet()
    const failure = secret()
    await expectGeneric500(await post(() => { throw failure }, { name: 'ada' }))
    expect(errors).toHaveBeenCalledWith(failure)
    // even a ZodError from rules() itself (building the schema), which is not a failure of the input
    await expectGeneric500(await post(() => { z.string().parse(1) }, { name: 'ada' }))
  })

  it('any Standard Schema validates: another zod copy or version, or another library', async () => {
    quiet()
    // what `instanceof ZodError` would miss: a schema from a second zod (or zod 4 mini, whose error is a $ZodError)
    const issues = [{ path: ['email'], message: 'Invalid email' }]
    const foreign = { '~standard': { version: 1, vendor: 'zod', validate: () => ({ issues }) } }
    const response = await post(() => foreign, { email: 'nope' })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual(issues)
  })

  it('an async refinement works: 422 when it fails, the controller when it passes', async () => {
    quiet()
    const taken = () => z.object({ email: z.string() }).refine(async (v) => v.email !== 'taken@example.test', { message: 'taken', path: ['email'] })
    const response = await post(taken, { email: 'taken@example.test' })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual([expect.objectContaining({ path: ['email'], message: 'taken' })])
    expect(await (await post(taken, { email: 'free@example.test' })).json()).toEqual({ created: true })
  })

  it('a ZodError from a nested parse inside the schema is a 500: it is not a failure of the input', async () => {
    quiet()
    const Config = z.object({ DB_PASSWORD: z.string() })
    const rules = () => z.object({ name: z.string() }).transform((v) => ({ ...v, config: Config.parse({}) }))
    await expectGeneric500(await post(rules, { name: 'ada' }))
    const text = await (await post(rules, { name: 'ada' })).text()
    expect(text).not.toContain('DB_PASSWORD')
  })

  it('rules() that returns no schema is a 500 with a server-side message', async () => {
    quiet()
    await expectGeneric500(await post(() => ({ parse: () => ({}) }), { name: 'ada' }))
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ message: 'UserRequest.rules() must return a Standard Schema (zod 3.24+, valibot, ...)' }))
  })
})
