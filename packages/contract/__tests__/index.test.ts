import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Endpoint, PACKAGE_NAME, defineError, endpoint } from '@laratype/contract'
import type { AnyEndpoint, AnyErrorDef } from '@laratype/contract'

const notFound = defineError(404, 'POST_NOT_FOUND')
const forbidden = defineError(403, 'NOT_OWNER')

describe('@laratype/contract', () => {
  it('can be imported', () => {
    expect(PACKAGE_NAME).toBe('@laratype/contract')
  })
})

describe('endpoint builder', () => {
  it('.response(schema) keeps a status set by .status(n); .response(schema, 204) throws (a 204 has no body)', () => {
    expect(endpoint.post('/jobs').status(202).response(z.string()).def.status).toBe(202)
    expect(endpoint.post('/jobs').status(204).response(z.string()).def.status).toBe(200)
    expect(endpoint.post('/jobs').status(202).response(z.string(), 201).def.status).toBe(201)
    expect(endpoint.get('/').response(z.string()).response(z.number()).def.status).toBe(200)
    expect(() => endpoint.get('/').response(z.string(), 204 as never)).toThrow(
      new TypeError('[@laratype/contract] response(): a 204 has no body; use .status(204)'),
    )
  })

  it('.status(n) sets a body-less 2xx; success statuses outside 200-299 throw at definition', () => {
    expect(endpoint.post('/jobs').status(202).def).toMatchObject({ status: 202 })
    expect(endpoint.post('/jobs').status(202).def.response).toBeUndefined()
    expect(() => endpoint.post('/jobs').status(301 as never)).toThrow(
      new TypeError('[@laratype/contract] status(): the status must be a 2xx success status, got 301'),
    )
    expect(() => endpoint.get('/').response(z.string(), 404 as never)).toThrow(
      new TypeError('[@laratype/contract] response(): the status must be a 2xx success status, got 404'),
    )
    expect(() => endpoint.get('/').response(z.string(), 200.5 as never)).toThrow(/2xx success status/)
    expect(() => (endpoint.get('/').response(z.string()) as unknown as AnyEndpoint).status(202)).toThrow(
      new TypeError('[@laratype/contract] status(): the endpoint has a response schema; use .response(schema, status)'),
    )
  })

  it.each(['get', 'post', 'put', 'patch', 'delete'] as const)('endpoint.%s(path) creates a bare def', (method) => {
    const e = endpoint[method]('/users/:user')

    expect(e).toBeInstanceOf(Endpoint)
    expect(e.def).toEqual({ method, path: '/users/:user', status: 204, throws: [] })
  })

  it('stores schemas, status and throws on the def', () => {
    const query = z.object({ page: z.coerce.number() })
    const body = z.object({ name: z.string() })
    const headers = z.object({ 'x-tenant': z.string() })
    const response = z.object({ id: z.number() })

    const e = endpoint
      .post('/users')
      .query(query)
      .body(body)
      .headers(headers)
      .response(response, 201)
      .throws(notFound)
      .throws(forbidden)

    expect(e.def).toEqual({
      method: 'post',
      path: '/users',
      query,
      body,
      headers,
      response,
      status: 201,
      throws: [notFound, forbidden],
    })
  })

  it('defaults the response status to 200', () => {
    expect(endpoint.get('/').response(z.string()).def.status).toBe(200)
  })

  it('keeps the default 200 status in a contextually typed position', () => {
    const contextual = <T extends Record<string, AnyEndpoint>>(x: T): T => x
    const ctx = contextual({ index: endpoint.get('/').response(z.string()) })

    expect(ctx.index.def.status).toBe(200)
  })

  it('appends throws in order across calls', () => {
    const e = endpoint.get('/').throws(notFound, forbidden).throws(notFound)

    expect(e.def.throws).toEqual([notFound, forbidden, notFound])
  })

  it('is immutable: each call returns a new endpoint and leaves the previous one untouched', () => {
    const base = endpoint.get('/users')
    const withQuery = base.query(z.object({ q: z.string() }))
    const withThrows = withQuery.throws(notFound)

    expect(withQuery).not.toBe(base)
    expect(base.def).toEqual({ method: 'get', path: '/users', status: 204, throws: [] })
    expect(base.def.query).toBeUndefined()
    expect(withQuery.def.throws).toEqual([])
    expect(withThrows.def.throws).toEqual([notFound])
  })

  it('freezes the def and its throws list', () => {
    const e = endpoint.get('/').throws(notFound)

    expect(Object.isFrozen(e.def)).toBe(true)
    expect(Object.isFrozen(e.def.throws)).toBe(true)
    expect(() => {
      (e.def as { path: string }).path = '/other'
    }).toThrow(TypeError)
  })

  it('does not freeze a def passed to the constructor', () => {
    const throws: AnyErrorDef[] = [notFound]
    const def = { method: 'get' as const, path: '/', status: 200, throws }
    const e = new Endpoint(def)

    expect(Object.isFrozen(def)).toBe(false)
    expect(Object.isFrozen(throws)).toBe(false)
    expect(Object.isFrozen(e.def.throws)).toBe(true)
    throws.push(forbidden)
    expect(e.def.throws).toEqual([notFound])
  })

  it('keeps __types phantom (no runtime property)', () => {
    const e = endpoint.get('/users/:user')

    expect('__types' in e).toBe(false)
    expect(Object.keys(e)).toEqual(['def'])
  })

  it('accepts any Standard Schema implementation', () => {
    const custom = {
      '~standard': {
        version: 1 as const,
        vendor: 'custom',
        validate: (value: unknown) => ({ value: String(value) }),
      },
    }

    expect(endpoint.get('/').query(custom).def.query).toBe(custom)
  })
})

describe('endpoint capabilities', () => {
  it('records auth, authorize and throttle on the def, a later call overriding the slot', () => {
    const e = endpoint.get('/').auth().authorize().throttle({ limit: 10, per: '1m' })

    expect(e.def).toMatchObject({ auth: true, authorize: true, throttle: { limit: 10, per: '1m' } })
    expect(Object.isFrozen(e.def.throttle)).toBe(true)
    expect(e.public().def.auth).toBe(false)
    expect(e.authorize(false).def.authorize).toBe(false)
    expect(e.throttle(false).def.throttle).toBe(false)
    expect(endpoint.get('/').auth('api' as never).def.auth).toBe('api')
    expect(e.def.auth).toBe(true)
  })

  it('leaves unset capabilities off the def (they are inherited)', () => {
    expect('auth' in endpoint.get('/').def).toBe(false)
    expect('throttle' in endpoint.get('/').def).toBe(false)
  })

  it.each([
    [{ limit: 0, per: 60 }],
    [{ limit: 1.5, per: 60 }],
    [{ limit: 10, per: 0 }],
    [{ limit: 10, per: '1w' }],
    [{ limit: 10 }],
    [null],
  ])('rejects the throttle %j', (options) => {
    expect(() => endpoint.get('/').throttle(options as never)).toThrow(/throttle must be/)
  })

  it('rejects invalid auth, authorize and throws values', () => {
    expect(() => endpoint.get('/').auth('' as never)).toThrow(/auth must be true or a guard name/)
    expect(() => endpoint.get('/').authorize('yes' as never)).toThrow(/expected a boolean/)
    expect(() => endpoint.get('/').throws({ status: 404, code: 'X' } as never)).toThrow(/use defineError/)
  })
})
