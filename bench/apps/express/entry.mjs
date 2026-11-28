import express from 'express'
import { userInput } from '../../shared/schemas.mjs'
import { validationError } from '../../shared/validation-error.mjs'

const app = express()
app.disable('x-powered-by')
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true }))

app.get('/api/json', (_req, res) => res.json({ message: 'Hello, World!' }))

app.get('/api/users/:id', (req, res) => res.json({ id: req.params.id }))

app.post('/api/users', (req, res) => {
  const parsed = userInput.safeParse(req.body)
  if (!parsed.success) return res.status(422).json(validationError(parsed.error.issues))
  return res.status(201).json({ id: 1, name: parsed.data.name, email: parsed.data.email })
})

const m1 = (req, _res, next) => {
  req.m1 = 1
  next()
}
const m2 = (req, _res, next) => {
  req.m2 = 1
  next()
}
const m3 = (req, _res, next) => {
  req.m3 = 1
  next()
}

app.get('/api/chain', m1, m2, m3, (req, res) => res.json({ m1: req.m1, m2: req.m2, m3: req.m3 }))

/** The per-request service of scenario 5: one object per request, the equivalent of Laratype's request scope. */
class ScopedService {
  constructor() {
    this.hits = 0
  }

  touch() {
    return ++this.hits
  }
}

const requestScope = (req, _res, next) => {
  req.service = new ScopedService()
  next()
}

app.get('/api/scoped', requestScope, (req, res) => res.json({ scoped: req.service.touch() }))

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'

app.listen(port, host)
