import { invalidUser, userInput, validUser } from './shared/schemas.mjs'
import { validationError } from './shared/validation-error.mjs'

const invalid = userInput.safeParse(invalidUser)
if (invalid.success) throw new Error('bench: the invalid fixture must not parse')

/**
 * The six scenarios of #353 phase 1. Bodies are the exact bytes expected on the wire (key order included); the
 * 422 body is derived from the shared schema's issues, never hard-coded per scenario.
 */
export const scenarios = Object.freeze([
  Object.freeze({
    name: 'json',
    method: 'GET',
    path: '/api/json',
    expectedStatus: 200,
    expectedBody: '{"message":"Hello, World!"}',
  }),
  Object.freeze({
    name: 'path-param',
    method: 'GET',
    path: '/api/users/42',
    expectedStatus: 200,
    expectedBody: '{"id":"42"}',
  }),
  Object.freeze({
    name: 'validation-ok',
    method: 'POST',
    path: '/api/users',
    body: validUser,
    expectedStatus: 201,
    expectedBody: '{"id":1,"name":"Ada","email":"ada@example.com"}',
  }),
  Object.freeze({
    name: 'validation-422',
    method: 'POST',
    path: '/api/users',
    body: invalidUser,
    expectedStatus: 422,
    expectedBody: JSON.stringify(validationError(invalid.error.issues)),
  }),
  Object.freeze({
    name: 'middleware',
    method: 'GET',
    path: '/api/chain',
    expectedStatus: 200,
    expectedBody: '{"m1":1,"m2":1,"m3":1}',
  }),
  Object.freeze({
    name: 'scoped',
    method: 'GET',
    path: '/api/scoped',
    expectedStatus: 200,
    expectedBody: '{"scoped":1}',
    requests: 2,
  }),
])

/** Scenario 6 is skipped in every app in phase 1: there is no v1 database API on master (DB1 #145 is planned). */
export const skipped = Object.freeze([
  Object.freeze({
    scenario: 'sqlite-read',
    reason: 'No v1 database API on master (DB1 #145 planned); Node 20.17 has no node:sqlite and bun:sqlite is Bun-only. Phase 2 with DB1.',
  }),
])
