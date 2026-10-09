import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Endpoint, PACKAGE_NAME, endpoint } from '@laratype/contract'
import type { ErrorDef } from '@laratype/contract'

const notFound: ErrorDef<404, { message: string }> = { status: 404, code: 'NOT_FOUND' }
const forbidden: ErrorDef<403, { message: string }> = { status: 403, code: 'FORBIDDEN' }

describe('@laratype/contract', () => {
  it('can be imported', () => {
    expect(PACKAGE_NAME).toBe('@laratype/contract')
  })
})

describe('endpoint builder', () => {
  it.each(['get', 'post', 'put', 'patch', 'delete'] as const)('endpoint.%s(path) creates a bare def', (method) => {
    const e = endpoint[method]('/users/:user')

    expect(e).toBeInstanceOf(Endpoint)
    expect(e.def).toEqual({ method, path: '/users/:user', status: 200, errors: [] })
  })

  it('stores schemas, status and errors on the def', () => {
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
      .errors(notFound)
      .errors(forbidden)

    expect(e.def).toEqual({
      method: 'post',
      path: '/users',
      query,
      body,
      headers,
      response,
      status: 201,
      errors: [notFound, forbidden],
    })
  })

  it('defaults the response status to 200', () => {
    expect(endpoint.get('/').response(z.string()).def.status).toBe(200)
  })

  it('appends errors in order across calls', () => {
    const e = endpoint.get('/').errors(notFound, forbidden).errors(notFound)

    expect(e.def.errors).toEqual([notFound, forbidden, notFound])
  })

  it('is immutable: each call returns a new endpoint and leaves the previous one untouched', () => {
    const base = endpoint.get('/users')
    const withQuery = base.query(z.object({ q: z.string() }))
    const withErrors = withQuery.errors(notFound)

    expect(withQuery).not.toBe(base)
    expect(base.def).toEqual({ method: 'get', path: '/users', status: 200, errors: [] })
    expect(base.def.query).toBeUndefined()
    expect(withQuery.def.errors).toEqual([])
    expect(withErrors.def.errors).toEqual([notFound])
  })

  it('freezes the def and its errors list', () => {
    const e = endpoint.get('/').errors(notFound)

    expect(Object.isFrozen(e.def)).toBe(true)
    expect(Object.isFrozen(e.def.errors)).toBe(true)
    expect(() => {
      (e.def as { path: string }).path = '/other'
    }).toThrow(TypeError)
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
