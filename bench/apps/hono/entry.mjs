import { Hono } from 'hono'
import { userInput } from '../../shared/schemas.mjs'
import { validationError } from '../../shared/validation-error.mjs'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

app.get('/api/json', (c) => c.json({ message: 'Hello, World!' }))

app.get('/api/users/:id', (c) => c.json({ id: c.req.param('id') }))

app.post('/api/users', async (c) => {
  const parsed = userInput.safeParse(await c.req.json())
  if (!parsed.success) return c.json(validationError(parsed.error.issues), 422)
  return c.json({ id: 1, name: parsed.data.name, email: parsed.data.email }, 201)
})

const m1 = async (c, next) => {
  c.set('m1', 1)
  await next()
}
const m2 = async (c, next) => {
  c.set('m2', 1)
  await next()
}
const m3 = async (c, next) => {
  c.set('m3', 1)
  await next()
}

app.get('/api/chain', m1, m2, m3, (c) => c.json({ m1: c.get('m1'), m2: c.get('m2'), m3: c.get('m3') }))

/** The per-request service of scenario 5: one object per request, the equivalent of Laratype's request scope. */
class ScopedService {
  constructor() {
    this.hits = 0
  }

  touch() {
    return ++this.hits
  }
}

const requestScope = async (c, next) => {
  c.set('service', new ScopedService())
  await next()
}

app.get('/api/scoped', requestScope, (c) => c.json({ scoped: c.get('service').touch() }))

const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOST ?? '127.0.0.1'

if (typeof Bun !== 'undefined') {
  Bun.serve({ fetch: app.fetch, port, hostname })
} else {
  const { serve } = await import('@hono/node-server')
  serve({ fetch: app.fetch, port, hostname })
}
