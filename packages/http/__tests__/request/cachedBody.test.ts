// H43 #340 / #345: a body an earlier middleware read reaches the pipeline with this pipeline's own parse options, and a
// read that cannot be served from Hono's cache is a 400 (or a clear diagnostic), never a corrupted 200 or a bare 500
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Request as LaratypeRequest, RequestKernel, ResponseKernel, Route } from '../../src/index'
import type { Ctx } from '../../src/index'

/** An app booted like `sauf dev`: RequestKernel runs the pipeline, ResponseKernel handles errors. */
const bootApp = (...middleware: MiddlewareHandler[]) => {
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

/** A 0.5 route whose request class validates `{ name, user? }`: what reaches the controller and `validated()`. */
const mount = (middleware: MiddlewareHandler[]) => {
  let validated: unknown
  class NameRequest extends LaratypeRequest { rules() { return z.object({ name: z.string(), user: z.object({ age: z.string() }).optional() }) } }
  class Users extends Controller { store(req: NameRequest) { validated = req.validated(); return { ok: true } } }
  const app = bootApp()
  app.post('/users', ...middleware, RequestKernel.handle({ method: 'post', path: '/users', request: NameRequest, controller: [Users, 'store'] }))
  return { app, validated: () => validated }
}

const urlencoded = (body: string) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })

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
    const response = await app.request('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'ada' }) })
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
    form.append('avatar', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])], 'a.png', { type: 'image/png' }))
    const response = await app.request('/users', { method: 'POST', body: form })
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
    const response = await app.request('/users', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data' }, body: 'not a multipart body' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Malformed form data in request body.' })
    expect(errors).not.toHaveBeenCalled()
  })

  it('a truncated JSON body is a 400 even when the signal never aborted', async () => {
    const errors = quiet()
    // The stream errors without a socket close (or the adapter never aborts the signal): the client's half body is
    // still the malformed-body 400 it was when the signal did abort
    const { app } = mount([])
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"name":'))
      },
      pull(controller) {
        controller.error(new Error('socket hang up'))
      },
    })
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' }
    const response = await app.request('/users', init)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Malformed JSON in request body.' })
    expect(errors).not.toHaveBeenCalled()
  })

  it('a truncated form body is a 400 even when the signal never aborted', async () => {
    const errors = quiet()
    const { app } = mount([])
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('--x\r\nContent-Disposition: form-data; name="name"\r\n\r\nada'))
      },
      pull(controller) {
        controller.error(new Error('socket hang up'))
      },
    })
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body, duplex: 'half' }
    const response = await app.request('/users', init)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Malformed form data in request body.' })
    expect(errors).not.toHaveBeenCalled()
  })

  it('a body read off c.req.raw directly is still a server bug: 500, not a 400', async () => {
    const errors = quiet()
    const { app } = mount([async (c, next) => { await c.req.raw.text(); await next() }])
    const form = new FormData()
    form.append('name', 'ada')
    const response = await app.request('/users', { method: 'POST', body: form })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'Server Error' })
    expect(errors).toHaveBeenCalled()
  })
})

describe('a cached body on a contract route (H43 #340)', () => {
  const upload = defineContract()({
    store: endpoint.post('/').body(z.object({ name: z.string(), user: z.object({ age: z.string() }), avatar: z.instanceof(File).optional() })).response(z.unknown(), 201),
  })
  class Uploads {
    store(ctx: Ctx<typeof upload.store>) {
      return { name: ctx.body.name, user: ctx.body.user, avatar: ctx.body.avatar && { name: ctx.body.avatar.name, size: ctx.body.avatar.size, type: ctx.body.avatar.type } }
    }
  }
  const contractApp = (middleware: MiddlewareHandler[]) => {
    const served = bootApp()
    served.use(...middleware)
    Route.api(defineApi({ uploads: { contract: upload, path: '/uploads', scopes: [] } }), (r) => [r.contract(upload, Uploads)]).mount(served)
    return served
  }

  it('the pipeline rebuilds a flat parseBody() result with dot keys and keeps a file part', async () => {
    quiet()
    const served = contractApp([async (c, next) => { await c.req.parseBody(); await next() }])
    const form = new FormData()
    form.append('name', 'ada')
    form.append('user.age', '36')
    form.append('avatar', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' }))
    const response = await served.request('/uploads', { method: 'POST', body: form })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ name: 'ada', user: { age: '36' }, avatar: { name: 'a.png', size: 4, type: 'image/png' } })
  })
})
