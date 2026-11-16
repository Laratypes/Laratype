// CL6 #159: dev-mode response validation. A call with `validateResponses` checks a success body against the endpoint's
// response schema and resolves a mismatch as the unexpected result, with a ResponseValidationError.
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { createClient, ResponseValidationError } from '@laratype/client'
import type { FetchLike } from '@laratype/client'
import { defineContract, defineError, endpoint } from '@laratype/contract'
import type { StandardIssue, StandardSchemaV1 } from '@laratype/contract'
import { manifest } from './fixtures/separate-fe/api'
import type { AppApi } from './fixtures/separate-fe/api'

/** A fetch that answers `body` as JSON with `status`, whatever the request. */
const jsonFetch = (body: unknown, status = 200): FetchLike => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * A Standard Schema whose `validate` is a spy, so a test can count the calls: `issues` decides a mismatch (otherwise
 * the parsed body is the output), and `tick` makes it await a macrotask, so it is an async schema.
 */
const schemaWith = (issues?: StandardIssue[], tick = 0) => {
  const validate = vi.fn(async (value: unknown) => {
    if (tick) await new Promise((resolve) => setTimeout(resolve, tick))
    return issues ? { issues } : { value }
  })
  const schema: StandardSchemaV1 = { '~standard': { version: 1, vendor: 'test', validate } }
  return { schema, validate }
}

describe('dev-mode response validation (CL6 #159)', () => {
  it('a body that matches the response schema resolves as the success, unchanged', async () => {
    const users = defineContract()({ show: endpoint.get('/api/users/:user').response(z.object({ id: z.number(), name: z.string() })) })
    const result = await createClient(users, { fetch: jsonFetch({ id: 1, name: 'Ada' }), validateResponses: true }).show({ params: { user: 1 } })
    expect(result).toMatchObject({ ok: true, status: 200, data: { id: 1, name: 'Ada' } })
  })

  it('a mismatch is the unexpected result with a ResponseValidationError: status, issues and path/messages, and no body value in the message', async () => {
    const { schema } = schemaWith([{ message: 'Required', path: ['name'] }])
    const things = defineContract()({ show: endpoint.get('/api/things/:id').response(schema) })
    const result = await createClient(things, { fetch: jsonFetch({ name: 'secret-token' }), validateResponses: true }).show({ params: { id: 1 } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.unexpected).toBe(true)
    expect(result.status).toBe(200)
    expect(result.response?.status).toBe(200)
    expect(result.code).toBeUndefined()
    expect(result.error).toBeInstanceOf(ResponseValidationError)
    const error = result.error as ResponseValidationError
    expect(error.message).toBe(
      "[@laratype/client] show: the response body does not match the endpoint's response schema (name: Required)",
    )
    expect({ ...error.errors }).toEqual({ name: ['Required'] })
    expect(error.issues).toEqual([{ message: 'Required', path: ['name'] }])
    // the diagnostic holds paths and the schema's messages, never the received body
    expect(error.message).not.toContain('secret-token')
  })

  it('an issue without a path is "(root)"', async () => {
    const { schema } = schemaWith([{ message: 'Expected an object' }])
    const things = defineContract()({ show: endpoint.get('/api/things').response(schema) })
    const result = await createClient(things, { fetch: jsonFetch('not an object'), validateResponses: true }).show()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as Error).message).toBe(
      "[@laratype/client] show: the response body does not match the endpoint's response schema ((root): Expected an object)",
    )
  })

  it('the option off, the default, never calls validate', async () => {
    const { schema, validate } = schemaWith()
    const things = defineContract()({ show: endpoint.get('/api/things').response(schema) })
    const result = await createClient(things, { fetch: jsonFetch({ any: 'thing' }) }).show()
    expect(result).toMatchObject({ ok: true, data: { any: 'thing' } })
    expect(validate).not.toHaveBeenCalled()
    // an explicit `false` is the same
    expect(await createClient(things, { fetch: jsonFetch({ other: true }), validateResponses: false }).show()).toMatchObject({ ok: true })
    expect(validate).not.toHaveBeenCalled()
  })

  it('skips a 204, a schema-less endpoint and a declared error body', async () => {
    const Conflict = defineError(409, 'CONFLICT', (message: string) => ({ message }))
    const { schema, validate } = schemaWith()
    const things = defineContract()({
      ping: endpoint.get('/api/ping').status(204),
      health: endpoint.get('/api/health'),
      store: endpoint.post('/api/things').response(schema).throws(Conflict),
      show: endpoint.get('/api/things').response(schema),
    })
    const fetch: FetchLike = async (url) =>
      url === '/api/things'
        ? new Response(JSON.stringify({ code: 'CONFLICT', message: 'taken' }), { status: 409, headers: { 'content-type': 'application/json' } })
        : new Response(null, { status: 204 })
    const api = createClient(things, { fetch, validateResponses: true })
    expect(await api.ping()).toMatchObject({ ok: true, status: 204, data: undefined })
    expect(await api.health()).toMatchObject({ ok: true, status: 204, data: undefined })
    // a declared error body has no schema in the contract, so there is nothing to validate
    expect(await api.store()).toMatchObject({ ok: false, status: 409, code: 'CONFLICT', error: { message: 'taken' } })
    expect(validate).not.toHaveBeenCalled()
  })

  it('awaits an async schema before the call settles, after onResponse', async () => {
    const order: string[] = []
    const validate = vi.fn(async (value: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      order.push('validate')
      return { value }
    })
    const schema: StandardSchemaV1 = { '~standard': { version: 1, vendor: 'test', validate } }
    const things = defineContract()({ show: endpoint.get('/api/things').response(schema) })
    const result = await createClient(things, {
      fetch: jsonFetch({ ok: true }),
      validateResponses: true,
      onResponse: () => {
        order.push('onResponse')
      },
    }).show()
    order.push('settled')
    expect(result.ok).toBe(true)
    // onResponse sees the response before the body is read or checked; the call waits for the schema
    expect(order).toEqual(['onResponse', 'validate', 'settled'])
  })

  it('keeps the parsed JSON as data, not the schema output: only the input is checked', async () => {
    const transformed = defineContract()({
      show: endpoint.get('/api/n').response(z.object({ n: z.string().transform((value) => value.length) })),
    })
    const result = await createClient(transformed, { fetch: jsonFetch({ n: 'ab' }), validateResponses: true }).show()
    expect(result).toMatchObject({ ok: true, data: { n: 'ab' } })
  })

  it('the generated manifest has no schemas: the option is refused at createClient', () => {
    // @ts-expect-error the manifest carries no response schemas
    expect(() => createClient<AppApi>(manifest, { validateResponses: true })).toThrow(
      "[@laratype/client] createClient: validateResponses needs the contract's response schemas; the generated manifest has none (use the appApi, an API node or a contract)",
    )
    // off is fine: the manifest client is unchanged
    const api = createClient<AppApi>(manifest, { fetch: jsonFetch({ id: 1 }), validateResponses: false })
    expect(typeof api.users.show).toBe('function')
  })
})
