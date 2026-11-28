// A8 #350: a hash-shaped password from a JSON body is hashed like any other password, and a JSON object shaped like a
// Hash.trusted() value is never trusted. The route is a real Hono request, so the body goes through JSON.parse().
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { Model } from '@laratype/database'
import { Hash } from '@laratype/support'

type Row = Record<string, any>

/** A User whose repository records the row `save()` writes; no database is needed. */
const model = () => {
  const saved: Row[] = []
  class User extends Model {
    id!: number
    email!: string
    password!: string
    static override readonly fillable = ['email', 'password']
  }
  (User as any).getRepository = () => ({
    save: async (data: Row | Row[]) => {
      saved.push(...(Array.isArray(data) ? data : [data]))
      return data
    },
  })
  return { User, saved }
}

/** The register route of examples/basic: the validated body goes to Model.save() as it is. */
const appOf = (User: typeof Model) => {
  const app = new Hono()
  app.post('/register', async (c) => {
    const body = await c.req.json()
    try {
      const user = await User.save(body)
      return c.json(user)
    } catch {
      return c.json({ error: 'Invalid password.' }, 422)
    }
  })
  return app
}

const post = (app: Hono, body: unknown) => app.request('/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('POST /register with a hash-shaped password', () => {
  it('stores a hash of the submitted string, not the string', async () => {
    const { User, saved } = model()
    const chosen = Hash.make('chosen-password')
    const response = await post(appOf(User), { email: 'ada@example.com', password: chosen })
    expect(response.status).toBe(200)
    const stored = saved[0]!.password
    expect(stored).not.toBe(chosen)
    expect(Hash.check(chosen, stored)).toBe(true)
    expect(await Hash.checkAsync(chosen, stored)).toBe(true)
    expect(Hash.check('chosen-password', stored)).toBe(false)
  })

  it('refuses a JSON object shaped like a trusted value: JSON cannot carry the brand', async () => {
    const { User, saved } = model()
    const response = await post(appOf(User), {
      email: 'ada@example.com',
      password: { hash: Hash.make('chosen-password') },
    })
    expect(response.status).toBe(422)
    expect(saved).toEqual([])
  })
})
