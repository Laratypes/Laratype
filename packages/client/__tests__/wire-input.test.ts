// CL7 #255: a Date in the request body or query round-trips against a server that validates the parsed JSON.
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import * as z from 'zod'
import { createClient } from '@laratype/client'
import { apiPaths, defineContract, endpoint, errors, toErrorBag, validate } from '@laratype/contract'

const Event = z.object({ at: z.date(), name: z.string(), isDate: z.boolean() })

const events = defineContract()({
  // the wire carries the ISO string, so the date field coerces it
  store: endpoint.post('/api/events').body(z.object({ at: z.coerce.date(), name: z.string() })).response(Event, 201),
  since: endpoint.get('/api/events').query(z.object({ since: z.coerce.date() })).response(z.object({ since: z.date(), isDate: z.boolean() })),
  // z.date() never accepts the parsed JSON: the string is not a Date
  strict: endpoint.post('/api/strict').body(z.object({ at: z.date() })),
})

/**
 * The server side of the request pipeline as validation.md specifies it (#106): the body is the parsed JSON and the
 * query the URL's values, each validated with the contract's `validate()`; a failure is the 422 `errors.validation`
 * body, sent as `{ code, ...body }`. The handler gets the validated output.
 */
const server = () => {
  const app = new Hono()
  const handlers: Record<string, (input: { body: any; query: any }) => unknown> = {
    store: ({ body }) => ({ at: body.at, name: body.name, isDate: body.at instanceof Date }),
    since: ({ query }) => ({ since: query.since, isDate: query.since instanceof Date }),
    strict: () => undefined,
  }
  for (const route of apiPaths(events)) {
    app.on(route.method.toUpperCase(), route.path, async (c) => {
      const { body: bodySchema, query: querySchema, status } = route.endpoint.def
      const input: { body?: unknown; query?: unknown } = {}
      for (const [slot, schema, value] of [
        ['body', bodySchema, bodySchema ? await c.req.json() : undefined],
        ['query', querySchema, c.req.query()],
      ] as const) {
        if (!schema) continue
        const result = await validate(schema, value)
        if (!result.ok) {
          const error = errors.validation(toErrorBag(result.issues))
          return c.json({ code: error.code, ...error.body }, error.status)
        }
        input[slot] = result.value
      }
      const data = handlers[route.name]!(input as { body: any; query: any })
      return data === undefined ? c.body(null, 204) : c.json(data, status as 200)
    })
  }
  return createClient(events, { baseUrl: 'http://localhost', fetch: async (url, init) => app.request(url, init) })
}

describe('a Date in the request input (#255)', () => {
  const at = new Date('2026-10-22T10:00:00.000Z')

  it('a Date body field is sent as its ISO string, validated without a 422, and comes back as that string', async () => {
    const result = await server().store({ body: { at, name: 'launch' } })
    expect(result).toMatchObject({ ok: true, status: 201, data: { at: at.toISOString(), name: 'launch', isDate: true } })
  })

  it('the ISO string the call type also accepts gives the same request', async () => {
    const result = await server().store({ body: { at: at.toISOString(), name: 'launch' } })
    expect(result).toMatchObject({ ok: true, status: 201, data: { at: at.toISOString(), isDate: true } })
  })

  it('a Date query value round-trips the same way', async () => {
    const result = await server().since({ query: { since: at } })
    expect(result).toMatchObject({ ok: true, status: 200, data: { since: at.toISOString(), isDate: true } })
  })

  it('a z.date() body field cannot validate the parsed JSON: 422, so the server schema must accept the ISO string', async () => {
    const result = await server().strict({ body: { at } })
    expect(result).toMatchObject({ ok: false, status: 422, code: 'VALIDATION_ERROR', error: { errors: { at: [expect.any(String)] } } })
  })
})
