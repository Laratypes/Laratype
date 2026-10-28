// Type tests for the request pipeline (H3 #106): run by `bunx vitest run --project types`.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import * as v from 'valibot'
import { z } from 'zod'
import { Controller, Request, RequestKernel } from '../../src/index'

class UserRepository { list() { return [] } }

describe('RequestKernel.handle', () => {
  test('takes any class the container can construct, constructor params included', () => {
    class UserController {
      constructor(private readonly repo: UserRepository) {}
      index() { return this.repo.list() }
    }
    RequestKernel.handle({ method: 'get', path: '/users', controller: [UserController, 'index'] })
    class Plain extends Controller { index() { return [] } }
    RequestKernel.handle({ method: 'get', path: '/plain', controller: [Plain, 'index'] })
    // @ts-expect-error a controller must be a class
    RequestKernel.handle({ method: 'get', path: '/x', controller: [() => ({}), 'index'] })
  })
})

describe('Request.validated()', () => {
  test('is the output of any Standard Schema rules()', () => {
    class Valibot extends Request {
      rules() { return v.object({ age: v.pipe(v.string(), v.transform(Number)) }) }
    }
    expectTypeOf(new Valibot(null as never).validated()).toEqualTypeOf<{ age: number }>()
    class Zod extends Request {
      rules() { return z.object({ page: z.coerce.number().default(1) }) }
    }
    expectTypeOf(new Zod(null as never).validated()).toEqualTypeOf<{ page: number }>()
  })

  test('is any without a schema, as before', () => {
    expectTypeOf(new Request(null as never).validated()).toBeAny()
  })
})
