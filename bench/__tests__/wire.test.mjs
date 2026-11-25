import { describe, expect, it } from 'vitest'
import { scenarios, skipped } from '../scenarios.mjs'
import { invalidUser, userInput, validUser } from '../shared/schemas.mjs'
import { validationError } from '../shared/validation-error.mjs'
import { autocannonArgs, requestFor, responseMatches } from '../lib/wire.mjs'

const byName = (name) => scenarios.find((scenario) => scenario.name === name)

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
