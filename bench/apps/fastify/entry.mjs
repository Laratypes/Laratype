import Fastify from 'fastify'
import { userInput } from '../../shared/schemas.mjs'
import { validationError } from '../../shared/validation-error.mjs'

const app = Fastify({ logger: false })

app.get('/health', async () => ({ ok: true }))

app.get('/api/json', async () => ({ message: 'Hello, World!' }))

app.get('/api/users/:id', async (request) => ({ id: request.params.id }))

app.post('/api/users', async (request, reply) => {
  const parsed = userInput.safeParse(request.body)
  if (!parsed.success) {
    reply.code(422)
    return validationError(parsed.error.issues)
  }
  reply.code(201)
  return { id: 1, name: parsed.data.name, email: parsed.data.email }
})

const m1 = async (request) => {
  request.m1 = 1
}
const m2 = async (request) => {
  request.m2 = 1
}
const m3 = async (request) => {
  request.m3 = 1
}

app.get('/api/chain', { preHandler: [m1, m2, m3] }, async (request) => ({
  m1: request.m1,
  m2: request.m2,
  m3: request.m3,
}))

/** The per-request service of scenario 5: one object per request, the equivalent of Laratype's request scope. */
class ScopedService {
  constructor() {
    this.hits = 0
  }

  touch() {
    return ++this.hits
  }
}

const requestScope = async (request) => {
  request.service = new ScopedService()
}

app.get('/api/scoped', { preHandler: [requestScope] }, async (request) => ({ scoped: request.service.touch() }))

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'

await app.listen({ port, host })
