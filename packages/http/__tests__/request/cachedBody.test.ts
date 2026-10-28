// H43 #340 / #345: a body an earlier middleware read reaches the pipeline with this pipeline's own parse options, and a
// read that cannot be served from Hono's cache is a 400 (or a clear diagnostic), never a corrupted 200 or a bare 500
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { validator } from 'hono/validator'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Request as LaratypeRequest, RequestKernel, ResponseKernel, Route } from '../../src/index'
import type { Ctx } from '../../src/index'

/** An app booted like `sauf dev`: RequestKernel runs the pipeline, ResponseKernel handles errors. */
const bootApp = (middleware: MiddlewareHandler[] = []) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  if (middleware.length > 0) app.use(...middleware)
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

const rules = () => z.object({ name: z.string(), user: z.object({ age: z.string() }).optional() })

/** A 0.5 route whose request class validates `{ name, user? }`: what reaches the controller and `validated()`. */
const mount = (middleware: MiddlewareHandler[]) => {
  let validated: unknown
  class NameRequest extends LaratypeRequest { rules() { return rules() } }
  class Users extends Controller { store(req: NameRequest) { validated = req.validated(); return { ok: true } } }
  const app = bootApp()
  const controller = [Users, 'store'] as const
  const route = { method: 'post', path: '/users', request: NameRequest, controller } as const
  app.post('/users', ...middleware, RequestKernel.handle(route))
  return { app, validated: () => validated }
}

const urlencoded = (body: string) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body,
})

const asJson = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const formInit = (body: BodyInit | ReadableStream<Uint8Array>) => ({ method: 'POST', body })

/** A body stream that sends `firstChunk`, then errors the way a truncated body does, with no signal abort. */
const truncated = (firstChunk: string): ReadableStream<Uint8Array> => new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new TextEncoder().encode(firstChunk))
  },
  pull(controller) {
    controller.error(new Error('socket hang up'))
  },
})

const half = (init: Record<string, unknown>, body: ReadableStream<Uint8Array>) =>
  ({ ...init, body, duplex: 'half' }) as RequestInit & { duplex: 'half' }

const jsonHeaders = { 'Content-Type': 'application/json' }
const multipartHeaders = { 'Content-Type': 'multipart/form-data; boundary=x' }

const truncatedJson = () => half({ method: 'POST', headers: jsonHeaders }, truncated('{"name":'))

const truncatedForm = (part: string) => half({ method: 'POST', headers: multipartHeaders }, truncated(part))

describe('a body read earlier by middleware (H43 #340)', () => {
  it('a flat parseBody() from middleware does not stop the pipeline reading dot keys', async () => {
    quiet()
    // Hono caches the flat object, so `parseBody({ dot: true })` returns it unchanged: the pipeline has to rebuild the
    // object from the cached FormData with its own options, or a nested body schema answers 422
    const { app, validated } = mount([async (c, next) => { await c.req.parseBody(); await next() }])
    const response = await app.request('/users', urlencoded('name=ada&user.age=36'))
    expect(response.status).toBe(201)
    expect(validated()).toEqual({ name: 'ada', user: { age: '36' } })
  })

  it('a parseBody({ all: true }) from middleware does not change how the pipeline reads a repeated field', async () => {
    quiet()
    const flat = mount([async (c, next) => { await c.req.parseBody({ all: true }); await next() }])
    const response = await flat.app.request('/users', urlencoded('name=ada&name=grace'))
    // A key sent twice without `all` is the last value, as `parseBody()` without options answers it
    expect(response.status).toBe(201)
    expect(flat.validated()).toEqual({ name: 'grace' })
  })

  it('a parseBody() from middleware on a JSON route does not cost the JSON body', async () => {
    quiet()
    // `parseBody()` on a JSON request answers `{}` without reading the stream, and Hono caches that plain object: a
    // `request.text()` on it fails with a TypeError. The pipeline reads the still-unread raw body instead
    const { app, validated } = mount([async (c, next) => { await c.req.parseBody(); await next() }])
    const response = await app.request('/users', asJson({ name: 'ada' }))
    expect(response.status).toBe(201)
    expect(validated()).toEqual({ name: 'ada' })
  })

  const jsonReaders: [string, MiddlewareHandler][] = [
    ['c.req.text()', async (c, next) => { await c.req.text(); await next() }],
    ['c.req.arrayBuffer()', async (c, next) => { await c.req.arrayBuffer(); await next() }],
    ["validator('json')", validator('json', (value) => value)],
  ]
  it.each(jsonReaders)('a JSON body read earlier by %s still reaches the handler', async (_reader, reader) => {
    quiet()
    // Hono's cache holds the reader's promise, not its value: the pipeline awaits it instead of reading it as text
    const { app, validated } = mount([reader])
    const response = await app.request('/users', asJson({ name: 'ada' }))
    expect(response.status).toBe(201)
    expect(validated()).toEqual({ name: 'ada' })
  })

  it('a form body a text read left blank is still no body', async () => {
    quiet()
    let validated: unknown
    class EmptyRequest extends LaratypeRequest { rules() { return z.object({}) } }
    class Empty extends Controller { store(req: EmptyRequest) { validated = req.validated(); return { ok: true } } }
    const app = bootApp([async (c, next) => { await c.req.text(); await next() }])
    const route = { method: 'post', path: '/empty', request: EmptyRequest, controller: [Empty, 'store'] as const }
    app.post('/empty', RequestKernel.handle(route))
    const response = await app.request('/empty', { method: 'POST', headers: multipartHeaders })
    expect(response.status).toBe(201)
    expect(validated).toEqual({})
  })

  it('a urlencoded body read by c.req.text() reaches the handler', async () => {
    quiet()
    // A urlencoded body is text by definition: its text is its body, dot keys included
    const { app, validated } = mount([async (c, next) => { await c.req.text(); await next() }])
    const response = await app.request('/users', urlencoded('name=ada&user.age=36'))
    expect(response.status).toBe(201)
    expect(validated()).toEqual({ name: 'ada', user: { age: '36' } })
  })

  it('a form body read earlier by c.req.blob() reaches the handler', async () => {
    quiet()
    const { app, validated } = mount([async (c, next) => { await c.req.blob(); await next() }])
    const response = await app.request('/users', urlencoded('name=ada'))
    expect(response.status).toBe(201)
    expect(validated()).toEqual({ name: 'ada' })
  })

  it('a form body read by c.req.text() is refused with a clear 500, not a corrupted 200', async () => {
    const errors = quiet()
    // The bytes are gone: a UTF-8 round trip would hand the handler a damaged file part, so this is the documented
    // server bug, with its own message
    const { app } = mount([async (c, next) => { await c.req.text(); await next() }])
    const form = new FormData()
    form.append('name', 'ada')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    form.append('avatar', new File([png], 'a.png', { type: 'image/png' }))
    const response = await app.request('/users', formInit(form))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'Server Error' })
    expect(errors).toHaveBeenCalled()
  })
})

describe('a body that cannot be read (H43 #340)', () => {
  it('a form parse a middleware swallowed is still the malformed-body 400', async () => {
    const errors = quiet()
    // The rejected `formData` promise stays in the cache: reading it as an array buffer throws a TypeError, and the
    // client's malformed body is a 400, not a logged 500
    const { app } = mount([async (c, next) => { try { await c.req.parseBody() } catch {} await next() }])
    const response = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: 'not a multipart body',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Malformed form data in request body.' })
    expect(errors).not.toHaveBeenCalled()
  })

  it('a truncated JSON body is a 400 even when the signal never aborted', async () => {
    const errors = quiet()
    // The stream errors without a socket close (or the adapter never aborts the signal): the client's half body is
    // still the malformed-body 400 it was when the signal did abort
    const { app } = mount([])
    const response = await app.request('/users', truncatedJson())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Malformed JSON in request body.' })
    expect(errors).not.toHaveBeenCalled()
  })

  it('a truncated form body is a 400 even when the signal never aborted', async () => {
    const errors = quiet()
    const { app } = mount([])
    const part = '--x\r\nContent-Disposition: form-data; name="name"\r\n\r\nada'
    const response = await app.request('/users', truncatedForm(part))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Malformed form data in request body.' })
    expect(errors).not.toHaveBeenCalled()
  })

  it('a truncated form body a middleware read is a 400, not a bare 500', async () => {
    const errors = quiet()
    // The cached `arrayBuffer` promise rejects with the stream's error: it is the same failed read as on the raw path
    const { app } = mount([async (c, next) => { try { await c.req.arrayBuffer() } catch {} await next() }])
    const part = '--x\r\nContent-Disposition: form-data; name="name"\r\n\r\nada'
    const response = await app.request('/users', truncatedForm(part))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Malformed form data in request body.' })
    expect(errors).not.toHaveBeenCalled()
  })

  it('a bodyLimit over a body a middleware parsed keeps its 413', async () => {
    quiet()
    // The form parse sees the stream bodyLimit errored, and its rejected promise keeps that `BodyLimitError`: it has to
    // reach bodyLimit's handler, not become a 400
    const parseQuietly = async (c: Parameters<MiddlewareHandler>[0], next: () => Promise<void>) => {
      try { await c.req.parseBody() } catch {} await next()
    }
    const { app } = mount([bodyLimit({ maxSize: 256 }), parseQuietly])
    const name = 'a'.repeat(512)
    const fields = `--x\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n--x--\r\n`
    const bytes = new TextEncoder().encode(fields)
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 32) controller.enqueue(bytes.slice(at, at + 32))
        controller.close()
      },
    })
    const init = half({ method: 'POST', headers: multipartHeaders }, chunked)
    expect((await app.request('/users', init)).status).toBe(413)
  })

  it('a body read off c.req.raw directly is still a server bug: 500, not a 400', async () => {
    const errors = quiet()
    const { app } = mount([async (c, next) => { await c.req.raw.text(); await next() }])
    const form = new FormData()
    form.append('name', 'ada')
    const response = await app.request('/users', formInit(form))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'Server Error' })
    expect(errors).toHaveBeenCalled()
  })
})

describe('a cached body on a contract route (H43 #340)', () => {
  const upload = defineContract()({
    store: endpoint.post('/')
      .body(z.object({ name: z.string(), user: z.object({ age: z.string() }), avatar: z.instanceof(File).optional() }))
      .response(z.unknown(), 201),
  })
  class Uploads {
    store(ctx: Ctx<typeof upload.store>) {
      const avatar = ctx.body.avatar
      return {
        name: ctx.body.name,
        user: ctx.body.user,
        avatar: avatar && { name: avatar.name, size: avatar.size, type: avatar.type },
      }
    }
  }
  const contractApp = (middleware: MiddlewareHandler[]) => {
    const served = bootApp(middleware)
    const api = defineApi({ uploads: { contract: upload, path: '/uploads', scopes: [] } })
    Route.api(api, (r) => [r.contract(upload, Uploads)]).mount(served)
    return served
  }

  it('the pipeline rebuilds a flat parseBody() result with dot keys and keeps a file part', async () => {
    quiet()
    const served = contractApp([async (c, next) => { await c.req.parseBody(); await next() }])
    const form = new FormData()
    form.append('name', 'ada')
    form.append('user.age', '36')
    form.append('avatar', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' }))
    const response = await served.request('/uploads', formInit(form))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      name: 'ada',
      user: { age: '36' },
      avatar: { name: 'a.png', size: 4, type: 'image/png' },
    })
  })
})
