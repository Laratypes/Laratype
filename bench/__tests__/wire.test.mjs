import { describe, expect, it } from 'vitest'
import { scenarios, skipped } from '../scenarios.mjs'
import { invalidUser, userInput, validUser } from '../shared/schemas.mjs'
import { validationError } from '../shared/validation-error.mjs'
import {
  autocannonArgs,
  measurementMatches,
  requestFor,
  responseMatches,
  SMOKE_TIMEOUT_MS,
  smokeRequest,
} from '../lib/wire.mjs'

const byName = (name) => scenarios.find((scenario) => scenario.name === name)

/** A fake autocannon result: the measured-run check never starts a server or a load generator. */
const measured = (overrides = {}) => ({
  requests: { average: 1000, total: 20 },
  errors: 0,
  timeouts: 0,
  non2xx: 0,
  statusCodeStats: { 200: { count: 20 } },
  ...overrides,
})

describe('scenarios', () => {
  it('lists the five JS scenarios in order and the skipped SQLite one', () => {
    expect(scenarios.map((scenario) => scenario.name)).toEqual(['json', 'path-param', 'validation-ok', 'validation-422', 'middleware', 'scoped'])
    expect(scenarios.every((scenario) => Object.isFrozen(scenario))).toBe(true)
    expect(skipped.map((item) => item.scenario)).toEqual(['sqlite-read'])
  })

  it('derives the 422 body from the shared schema issues, byte for byte', () => {
    const invalid = userInput.safeParse(invalidUser)
    expect(invalid.success).toBe(false)
    const expected = JSON.stringify(validationError(invalid.error.issues))
    expect(byName('validation-422').expectedBody).toBe(expected)
    expect(expected).toBe(
      '{"code":"VALIDATION_ERROR","message":"The given data was invalid.","errors":{"name":["Too small: expected string to have >=1 characters"],"email":["Invalid email address"]}}',
    )
  })

  it('keeps every expected body exact and frozen', () => {
    expect(byName('json').expectedBody).toBe('{"message":"Hello, World!"}')
    expect(byName('path-param').expectedBody).toBe('{"id":"42"}')
    expect(byName('validation-ok').expectedBody).toBe('{"id":1,"name":"Ada","email":"ada@example.com"}')
    expect(byName('middleware').expectedBody).toBe('{"m1":1,"m2":1,"m3":1}')
    expect(byName('scoped')).toMatchObject({ expectedStatus: 200, expectedBody: '{"scoped":1}', requests: 2 })
    expect(validUser).toEqual({ name: 'Ada', email: 'ada@example.com' })
  })
})

describe('responseMatches', () => {
  it('accepts the exact status and raw body', () => {
    expect(responseMatches(byName('json'), 200, '{"message":"Hello, World!"}')).toBe(true)
    expect(responseMatches(byName('validation-422'), 422, byName('validation-422').expectedBody)).toBe(true)
  })

  it('rejects a different status, key order or whitespace', () => {
    expect(responseMatches(byName('json'), 201, '{"message":"Hello, World!"}')).toBe(false)
    expect(responseMatches(byName('json'), 200, '{"message": "Hello, World!"}')).toBe(false)
    expect(responseMatches(byName('json'), 200, '{"Message":"Hello, World!"}')).toBe(false)
  })
})

describe('measurementMatches', () => {
  it('accepts a run whose completed responses all carry the expected status', () => {
    expect(measurementMatches(byName('json'), measured())).toEqual({ ok: true })
    expect(measurementMatches(byName('json'), measured({ statusCodeStats: { 200: { count: '20' } } }))).toEqual({ ok: true })
  })

  it('accepts the expected 422 even though autocannon counts it in non2xx', () => {
    const result = measured({ non2xx: 20, statusCodeStats: { 422: { count: 20 } } })
    expect(measurementMatches(byName('validation-422'), result)).toEqual({ ok: true })
  })

  it('rejects an HTTP 500 measured as if the scenario had succeeded', () => {
    const result = measured({ non2xx: 20, statusCodeStats: { 500: { count: 20 } } })
    expect(measurementMatches(byName('json'), result)).toEqual({ ok: false, reason: 'unexpected status code(s): 500 (20)' })
  })

  it('rejects a mix of the expected status and another status', () => {
    const result = measured({ non2xx: 5, statusCodeStats: { 200: { count: 15 }, 500: { count: 5 } } })
    expect(measurementMatches(byName('json'), result)).toEqual({ ok: false, reason: 'unexpected status code(s): 500 (5)' })
    const wrong = measured({ non2xx: 20, statusCodeStats: { 500: { count: 20 } } })
    expect(measurementMatches(byName('validation-422'), wrong).ok).toBe(false)
  })

  it('rejects connection errors, timeouts and an empty measurement', () => {
    expect(measurementMatches(byName('json'), measured({ errors: 2 }))).toEqual({ ok: false, reason: '2 connection error(s)' })
    expect(measurementMatches(byName('json'), measured({ timeouts: 1 }))).toEqual({ ok: false, reason: '1 timeout(s)' })
    expect(measurementMatches(byName('json'), measured({ requests: { average: 0, total: 0 }, statusCodeStats: {} }))).toEqual({
      ok: false,
      reason: 'no completed responses',
    })
  })

  it('rejects a report whose completed count disagrees with the expected status count', () => {
    expect(measurementMatches(byName('json'), measured({ statusCodeStats: { 200: { count: 19 } } }))).toEqual({
      ok: false,
      reason: '19 of 20 completed responses were 200',
    })
    expect(measurementMatches(byName('json'), measured({ statusCodeStats: { 200: { count: 20 }, 302: { count: 0 } } }))).toEqual({ ok: true })
  })
})

describe('requestFor', () => {
  it('builds a GET with no body', () => {
    const [url, init] = requestFor(byName('json'), 3210)
    expect(url).toBe('http://127.0.0.1:3210/api/json')
    expect(init).toEqual({ method: 'GET', headers: {}, body: undefined })
  })

  it('builds a JSON POST with the exact scenario body', () => {
    const [url, init] = requestFor(byName('validation-ok'), 3210)
    expect(url).toBe('http://127.0.0.1:3210/api/users')
    expect(init).toEqual({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"Ada","email":"ada@example.com"}',
    })
  })
})

describe('smokeRequest', () => {
  it('returns the status and body of an answered request', async () => {
    const fetchImpl = async (_url, init) => {
      expect(init.signal).toBeInstanceOf(AbortSignal)
      return { status: 200, text: async () => '{"message":"Hello, World!"}' }
    }
    await expect(smokeRequest(fetchImpl, byName('json'), 3210, 100)).resolves.toEqual({
      status: 200,
      text: '{"message":"Hello, World!"}',
    })
  })

  it('fails a fetch that never settles within the injected deadline', async () => {
    const started = Date.now()
    await expect(smokeRequest(() => new Promise(() => {}), byName('json'), 3210, 20)).rejects.toThrow(
      'smoke: json did not answer within 20 ms',
    )
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('covers the body read with the same deadline', async () => {
    const fetchImpl = async (_url, init) => ({
      status: 200,
      text: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
    })
    await expect(smokeRequest(fetchImpl, byName('json'), 3210, 20)).rejects.toThrow('smoke: json did not answer within 20 ms')
  })

  it('uses a few seconds by default, well inside the workflow timeout', () => {
    expect(SMOKE_TIMEOUT_MS).toBe(5000)
  })
})

describe('autocannonArgs', () => {
  const base = { port: 3210, connections: 50, duration: 10 }
  it('adds the body file and JSON header only for a request with a body', () => {
    expect(autocannonArgs(byName('json'), base)).toEqual(['-c', '50', '-d', '10', '-p', '1', '-j', '-m', 'GET', 'http://127.0.0.1:3210/api/json'])
    expect(autocannonArgs(byName('validation-422'), { ...base, bodyFile: '/out/tmp/validation-422.json' })).toEqual([
      '-c',
      '50',
      '-d',
      '10',
      '-p',
      '1',
      '-j',
      '-m',
      'POST',
      '-H',
      'content-type: application/json',
      '-i',
      '/out/tmp/validation-422.json',
      'http://127.0.0.1:3210/api/users',
    ])
  })
})
