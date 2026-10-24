// H3 #106 / H26 #287: the request pipeline parses the body by media type, validates a contract route's query and
// body, answers 422 with the error bag and builds the handler ctx
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import * as v from 'valibot'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Request as LaratypeRequest, RequestKernel, ResponseKernel, Route } from '../../src/index'
import type { Ctx } from '../../src/index'

/** An app booted like `sauf dev`: RequestKernel runs the pipeline, ResponseKernel handles errors. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  return app
}

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {}
})

afterEach(() => {
  vi.restoreAllMocks()
})

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

const json = (body: unknown, contentType = 'application/json') =>
  ({ method: 'POST', headers: { 'Content-Type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('a contract route', () => {
  const Post = z.object({ title: z.string(), tags: z.array(z.string()).default([]) })
  const posts = defineContract()({
    index: endpoint.get('/').query(z.object({ page: z.coerce.number().int().min(1).default(1), tag: z.array(z.string()).optional() })).response(z.unknown()),
    store: endpoint.post('/').query(z.object({ draft: z.enum(['yes', 'no']).optional() })).body(Post).response(z.unknown(), 201),
    show: endpoint.get('/:post').response(z.unknown()),
  })
  const appApi = defineApi({ 'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [], dirs: [] } })
  const seen: unknown[] = []

  class PostController {
    index(ctx: Ctx<typeof posts.index>) { seen.push(ctx); return { query: ctx.query } }
    store(ctx: Ctx<typeof posts.store>) { seen.push(ctx); return { query: ctx.query, body: ctx.body } }
    show(ctx: Ctx<typeof posts.show, { params: { user: string } }>) { seen.push(ctx); return { params: ctx.params, query: ctx.query ?? null, body: ctx.body ?? null } }
  }

  const app = () => {
    const served = bootApp()
    Route.api(appApi, (r) => [r.contract(posts, PostController)]).mount(served)
    return served
  }

  it('passes the validated output: query values coerced and defaulted, a repeated key as an array', async () => {
    quiet()
    expect(await (await app().request('/api/users/7/posts?page=2')).json()).toEqual({ query: { page: 2 } })
    expect(await (await app().request('/api/users/7/posts')).json()).toEqual({ query: { page: 1 } })
    expect(await (await app().request('/api/users/7/posts?tag=a&tag=b')).json()).toEqual({ query: { page: 1, tag: ['a', 'b'] } })
  })

  it('passes the body output, and keeps query and body apart', async () => {
    quiet()
    const response = await app().request('/api/users/7/posts?draft=yes', json({ title: 'Hi', draft: 'body' }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ query: { draft: 'yes' }, body: { title: 'Hi', tags: [] } })
  })

  it('builds the ctx: raw path params, folder params included; a slot without a schema is undefined', async () => {
    quiet()
    seen.length = 0
    const response = await app().request('/api/users/7/posts/42?page=3')
    expect(await response.json()).toEqual({ params: { user: '7', post: '42' }, query: null, body: null })
    const ctx = seen[0] as Ctx<typeof posts.show>
    expect(ctx.endpoint).toBe(posts.show)
    expect(Object.keys(ctx)).toEqual(['params', 'query', 'body'])
  })

  it('answers invalid input with 422 and the error bag of the query and the body together', async () => {
    quiet()
    const response = await app().request('/api/users/7/posts?draft=maybe', json({ tags: 'nope' }))
    expect(response.status).toBe(422)
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json/)
    const body = await response.json()
    expect(Object.keys(body)).toEqual(['code', 'message', 'errors'])
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.message).toBe('The given data was invalid.')
    expect(Object.keys(body.errors).sort()).toEqual(['draft', 'tags', 'title'])
    expect(body.errors.title).toEqual(['Required'])
    const invalid = await app().request('/api/users/7/posts?page=0')
    expect(invalid.status).toBe(422)
    expect((await invalid.json()).errors.page).toHaveLength(1)
  })

  it('a GET with a JSON Content-Type and no body is no body, not a 400', async () => {
    quiet()
    const response = await app().request('/api/users/7/posts?page=2', { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ query: { page: 2 } })
  })

  it('a 422 message never repeats the submitted value', async () => {
    quiet()
    const response = await app().request('/api/users/7/posts?draft=s3cr3t', json({ title: 'Hi' }))
    const text = await response.text()
    expect(response.status).toBe(422)
    expect(text).not.toContain('s3cr3t')
    expect(JSON.parse(text).errors.draft).toEqual(["Invalid enum value. Expected 'yes' | 'no'"])
  })

  it('an error thrown inside a schema is a generic 500, not a 422', async () => {
    const errors = quiet()
    const failure = new Error('db at 10.0.0.7 refused')
    const risky = defineContract()({ store: endpoint.post('/').body(z.object({ name: z.string() }).superRefine(() => { throw failure })) })
    class Risky { store() {} }
    const served = bootApp()
    Route.api(defineApi({ risky: { contract: risky, path: '/risky', scopes: [], dirs: [] } }), (r) => [r.contract(risky, Risky)]).mount(served)
    const response = await served.request('/risky', json({ name: 'ada' }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'Server Error' })
    expect(errors).toHaveBeenCalledWith(failure)
  })

  it('cuts a valibot "Received" value too', async () => {
    quiet()
    const mails = defineContract()({ send: endpoint.post('/').body(v.object({ email: v.pipe(v.string(), v.email()) })) })
    class Mails { send() {} }
    const served = bootApp()
    Route.api(defineApi({ mails: { contract: mails, path: '/mails', scopes: [], dirs: [] } }), (r) => [r.contract(mails, Mails)]).mount(served)
    const response = await served.request('/mails', json({ email: 'alice.s3cr3t' }))
    const text = await response.text()
    expect(response.status).toBe(422)
    expect(JSON.parse(text).errors).toEqual({ email: ['Invalid email'] })
    expect(text).not.toContain('s3cr3t')
  })

  it('cuts a received value with non-ASCII characters at the right index', async () => {
    quiet()
    // `İ` lowercases to two code units: an index taken in the lowercased message would cut too early
    const issues = [{ message: 'Invalid email: Received "İİİİİ"', path: ['email'], received: '"İİİİİ"' }]
    const schema = { '~standard': { version: 1, vendor: 'other', validate: () => ({ issues }) } } as const
    const mails = defineContract()({ send: endpoint.post('/').body(schema) })
    class Mails { send() {} }
    const served = bootApp()
    Route.api(defineApi({ mails: { contract: mails, path: '/mails', scopes: [], dirs: [] } }), (r) => [r.contract(mails, Mails)]).mount(served)
    const response = await served.request('/mails', json({ email: 'İİİİİ' }))
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({ email: ['Invalid email'] })
  })

  it.each([
    // zod 3 style: a bare received value quoted by the message
    [{ message: "Invalid enum value. Expected 'a', received 'İİİİİ'", received: 'İİİİİ' }, "Invalid enum value. Expected 'a'"],
    // the value in another case than the issue's received
    [{ message: 'Invalid email: Received "SECRET"', received: '"secret"' }, 'Invalid email'],
    // nothing left once the value is cut
    [{ message: 'Received "secret"', received: '"secret"' }, 'Invalid value'],
    // "received" inside a word is not the tail, whole code points and combining marks included
    [{ message: 'Field unreceived 5', received: 5 }, 'Field unreceived 5'],
    [{ message: '𝐱received 5', received: 5 }, '𝐱received 5'],
    [{ message: 'e\u0301received 5', received: 5 }, 'e\u0301received 5'],
    // every separator before the tail goes
    [{ message: 'Invalid: but received "x"', received: '"x"' }, 'Invalid'],
    [{ message: 'Expected x,  but  :, received 5', received: 5 }, 'Expected x'],
    // "but" only as a word
    [{ message: 'Expected abut received 5', received: 5 }, 'Expected abut'],
    // unrecognized keys with nothing before them
    [{ message: ': a', keys: ['a'] }, 'Invalid value'],
  ])('cuts the received value of %o', async (issue, message) => {
    quiet()
    const schema = { '~standard': { version: 1, vendor: 'other', validate: () => ({ issues: [{ ...issue, path: ['email'] }] }) } } as const
    const mails = defineContract()({ send: endpoint.post('/').body(schema) })
    class Mails { send() {} }
    const served = bootApp()
    Route.api(defineApi({ mails: { contract: mails, path: '/mails', scopes: [], dirs: [] } }), (r) => [r.contract(mails, Mails)]).mount(served)
    const response = await served.request('/mails', json({ email: 'x' }))
    expect((await response.json()).errors).toEqual({ email: [message] })
  })

  it('a message of many separators is cut in linear time (no regex backtracking)', async () => {
    quiet()
    const message = `x${'  but'.repeat(20_000)}, received 5`
    const schema = { '~standard': { version: 1, vendor: 'other', validate: () => ({ issues: [{ message, received: 5, path: ['n'] }] }) } } as const
    const slow = defineContract()({ send: endpoint.post('/').body(schema) })
    class Slow { send() {} }
    const served = bootApp()
    Route.api(defineApi({ slow: { contract: slow, path: '/slow', scopes: [], dirs: [] } }), (r) => [r.contract(slow, Slow)]).mount(served)
    const started = performance.now()
    const response = await served.request('/slow', json({ n: 1 }))
    expect((await response.json()).errors).toEqual({ n: ['x'] })
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('validates with any Standard Schema library', async () => {
    quiet()
    const forms = defineContract()({ send: endpoint.post('/').body(v.object({ age: v.pipe(v.string(), v.transform(Number)) })).response(z.unknown()) })
    class Forms { send(ctx: Ctx<typeof forms.send>) { return { age: ctx.body.age } } }
    const served = bootApp()
    Route.api(defineApi({ forms: { contract: forms, path: '/forms', scopes: [], dirs: [] } }), (r) => [r.contract(forms, Forms)]).mount(served)
    expect(await (await served.request('/forms', json({ age: '42' }))).json()).toEqual({ age: 42 })
    const invalid = await served.request('/forms', json({ age: 7 }))
    expect(invalid.status).toBe(422)
    const text = await invalid.text()
    // valibot's default message ends with the received value: it is cut
    expect(JSON.parse(text).errors).toEqual({ age: ['Invalid type: Expected string'] })
    expect(text).not.toContain('7')
  })
})

describe('the body by media type (H26 #287)', () => {
  /** A 0.5 route whose request class validates `{ name }`: what reaches the controller and `validated()`. */
  const serve = () => {
    let validated: unknown
    class NameRequest extends LaratypeRequest { rules() { return z.object({ name: z.string(), user: z.object({ age: z.string() }).optional() }) } }
    class Users extends Controller { store(req: NameRequest) { validated = req.validated(); return { ok: true } } }
    const app = bootApp()
    app.post('/users', RequestKernel.handle({ method: 'post', path: '/users', request: NameRequest, controller: [Users, 'store'] }))
    return { app, validated: () => validated }
  }

  it.each([
    'application/json; charset=utf-8',
    'application/json;charset=UTF-8',
    'application/vnd.api+json',
    // a digit in the vendor prefix: Hono's own regex misses it (#287)
    'application/vnd.github.v3+json',
    'Application/JSON',
  ])('reads %s as JSON, up to the controller and validated()', async (contentType) => {
    quiet()
    const { app, validated } = serve()
    const response = await app.request('/users', json({ name: 'ada' }, contentType))
    expect(response.status).toBe(201)
    expect(validated()).toEqual({ name: 'ada' })
  })

  it('still parses form bodies, multipart and urlencoded, with dot: true', async () => {
    quiet()
    const { app, validated } = serve()
    const form = new FormData()
    form.append('name', 'ada')
    form.append('user.age', '36')
    expect((await app.request('/users', { method: 'POST', body: form })).status).toBe(201)
    expect(validated()).toEqual({ name: 'ada', user: { age: '36' } })
    const encoded = await app.request('/users', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=grace&user.age=45' })
    expect(encoded.status).toBe(201)
    expect(validated()).toEqual({ name: 'grace', user: { age: '45' } })
  })

  it('a multipart file field is a web File', async () => {
    quiet()
    const upload = defineContract()({ store: endpoint.post('/').body(z.object({ avatar: z.instanceof(File) })).response(z.unknown(), 201) })
    class Uploads { store(ctx: Ctx<typeof upload.store>) { return { name: ctx.body.avatar.name, size: ctx.body.avatar.size } } }
    const app = bootApp()
    Route.api(defineApi({ uploads: { contract: upload, path: '/uploads', scopes: [], dirs: [] } }), (r) => [r.contract(upload, Uploads)]).mount(app)
    const form = new FormData()
    form.append('avatar', new File(['abc'], 'a.png', { type: 'image/png' }))
    expect(await (await app.request('/uploads', { method: 'POST', body: form })).json()).toEqual({ name: 'a.png', size: 3 })
  })

  it('a malformed JSON body is a 400 with a generic body, not a 500', async () => {
    const errors = quiet()
    const { app } = serve()
    const response = await app.request('/users', json('{"name":'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Malformed JSON in request body.' })
    expect(errors).not.toHaveBeenCalled()
  })
})

describe('a 0.5 request class', () => {
  const post = async (rules: () => unknown, body: object) => {
    class UserRequest extends LaratypeRequest { rules() { return rules() as never } }
    class Users extends Controller { store() { return { created: true } } }
    const app = bootApp()
    app.post('/users', RequestKernel.handle({ method: 'post', path: '/users', request: UserRequest, controller: [Users, 'store'] }))
    return app.request('/users', json(body))
  }

  it('answers a zod failure with { path, message } issues only, without the submitted value', async () => {
    quiet()
    const response = await post(() => z.object({ role: z.enum(['admin', 'user']), name: z.string() }), { role: 's3cr3t' })
    expect(response.status).toBe(422)
    const text = await response.text()
    expect(JSON.parse(text).errors).toEqual([
      { path: ['role'], message: "Invalid enum value. Expected 'admin' | 'user'" },
      { path: ['name'], message: 'Required' },
    ])
    expect(text).not.toContain('s3cr3t')
  })

  it('keeps a message of the app own, and the type name of an invalid_type', async () => {
    quiet()
    const response = await post(() => z.object({ name: z.string().min(3, 'Name too short'), age: z.number() }), { name: 'a', age: 'x' })
    expect((await response.json()).errors).toEqual([
      { path: ['name'], message: 'Name too short' },
      { path: ['age'], message: 'Expected number, received string' },
    ])
  })

  it('cuts the unrecognized keys of a strict object from the message', async () => {
    quiet()
    const response = await post(() => z.object({ name: z.string() }).strict(), { name: 'ada', s3cr3t: 1 })
    const text = await response.text()
    expect(JSON.parse(text).errors).toEqual([{ path: [], message: 'Unrecognized key(s) in object' }])
    expect(text).not.toContain('s3cr3t')
  })

  it('a default rules() is told by its brand, so another copy of @laratype/http skips it too', async () => {
    quiet()
    let validated: unknown
    const copy = function rules() { return {} }
    Object.defineProperty(copy, Symbol.for('laratype.http.defaultRules'), { value: true })
    class FromOtherCopy extends LaratypeRequest {}
    Object.defineProperty(FromOtherCopy.prototype, 'rules', { value: copy })
    class Reader extends Controller { store(req: LaratypeRequest) { validated = req.validated(); return {} } }
    const app = bootApp()
    app.post('/copy', RequestKernel.handle({ method: 'post', path: '/copy', request: FromOtherCopy, controller: [Reader, 'store'] }))
    expect((await app.request('/copy', json({ name: 'ada' }))).status).toBe(201)
    expect(validated).toEqual({})
  })
})
