// @ts-check
// Generates the type-performance fixture of `bun run bench:types` (S6 #95).
//
// The fixture is a small but real Laratype app: `defineContract` contracts mounted through `defineApi`,
// `Route.api` with `r.contract()` and a controller per contract, and client calls for every endpoint.
// It uses the public APIs only (no private module) and a tiny Standard Schema helper instead of a schema
// library, so the numbers measure the framework's types and not zod's.

/** Endpoints per generated contract: ten CRUD-ish routes, so 500 endpoints is 50 contracts. */
const ENDPOINTS_PER_CONTRACT = 10

/**
 * Contracts per `defineApi` root used by the route modules. A single `Route.api` over 100 contracts
 * hits TS2589 today (the route proof instantiates too deep); 50-contract groups type-check, and a
 * large app splits its route modules anyway.
 */
const CONTRACTS_PER_ROUTE_GROUP = 50

/**
 * @typedef {{
 *   key: string,
 *   method: 'get' | 'post' | 'patch' | 'delete',
 *   path: string,
 *   query?: 'index' | 'search',
 *   body?: 'create' | 'update',
 *   headers?: boolean,
 *   response?: 'item' | 'list' | 'stats',
 *   status?: number,
 *   public?: boolean,
 *   authorize?: boolean,
 *   throttle?: false,
 *   throws?: readonly string[],
 * }} Template
 */

/** @type {readonly Template[]} */
const TEMPLATES = [
  { key: 'index', method: 'get', path: '/', query: 'index', response: 'list' },
  { key: 'show', method: 'get', path: '/:id', response: 'item', throws: ['ResourceMissing'] },
  { key: 'store', method: 'post', path: '/', body: 'create', response: 'item', status: 201, throws: ['EmailTaken'] },
  { key: 'update', method: 'patch', path: '/:id', body: 'update', response: 'item', throws: ['ResourceMissing'] },
  { key: 'destroy', method: 'delete', path: '/:id', status: 204 },
  { key: 'search', method: 'get', path: '/search', query: 'search', response: 'list', public: true },
  { key: 'stats', method: 'get', path: '/stats', response: 'stats', authorize: true },
  { key: 'archive', method: 'post', path: '/:id/archive', status: 202, throttle: false },
  { key: 'export', method: 'get', path: '/export', headers: true, response: 'list' },
  { key: 'restore', method: 'patch', path: '/:id/restore', response: 'item' },
]

/** The contract's URL prefix: one folder param, so every endpoint carries it in its params and errors. */
const prefixOf = (/** @type {number} */ i) => `/api/teams/:team/resource${i}`

const ERRORS_FILE = `import { defineError } from '@laratype/contract'

export const ResourceMissing = defineError(404, 'RESOURCE_MISSING', (id: number | string) => ({ message: \`Resource \${id} not found.\`, id }))
export const EmailTaken = defineError(409, 'EMAIL_TAKEN', (email: string) => ({ message: 'The email is taken.', email }))
`

const SCHEMA_FILE = `import type { StandardSchemaV1 } from '@laratype/contract'

/**
 * A Standard Schema v1 whose input and output are T. No runtime validation: this is a benchmark fixture,
 * and the framework takes any Standard Schema, so it needs no schema library.
 */
export const schema = <T>(): StandardSchemaV1<T, T> => ({
  '~standard': {
    version: 1,
    vendor: 'bench-types',
    validate: (value) => ({ value: value as T }),
  },
})
`

/**
 * One contract file, with the DTO types its controller and client reuse.
 * @param {number} i
 * @param {readonly Template[]} templates
 */
const contractFile = (i, templates) => {
  const resourceType = `Resource${i}`
  const stats = `Stats${i}`
  const used = (/** @type {Template['response']} */ response) => templates.some((t) => t.response === response)
  const lines = [
    "import { defineContract, endpoint } from '@laratype/contract'",
    "import type { ContractPrefix } from '@laratype/contract'",
    "import { EmailTaken, ResourceMissing } from '../errors'",
    "import { schema } from '../schema'",
    '',
    `export type ${resourceType} = {`,
    '  id: number',
    '  name: string',
    `  field${i}: string`,
    '  meta: { createdAt: string; flags: number[]; owner: { id: number; name: string } }',
    '}',
  ]
  if (used('stats')) lines.push('', `export type ${stats} = { total: number; byStatus: Record<string, number> }`)
  lines.push('')
  if (used('item')) lines.push(`const ResourceSchema = schema<${resourceType}>()`)
  if (used('list')) lines.push(`const ResourceListSchema = schema<${resourceType}[]>()`)
  if (used('stats')) lines.push(`const StatsSchema = schema<${stats}>()`)
  if (templates.some((t) => t.query === 'index')) lines.push('const IndexQuerySchema = schema<{ page: number; perPage?: number }>()')
  if (templates.some((t) => t.query === 'search')) lines.push('const SearchQuerySchema = schema<{ q: string; limit?: number }>()')
  if (templates.some((t) => t.body === 'create')) lines.push('const CreateBodySchema = schema<{ name: string; email: string; note?: string }>()')
  if (templates.some((t) => t.body === 'update')) lines.push('const UpdateBodySchema = schema<{ name?: string; note?: string }>()')
  if (templates.some((t) => t.headers)) lines.push("const ExportHeadersSchema = schema<{ 'x-api-key': string }>()")
  lines.push('', `type Prefix = ContractPrefix<'${prefixOf(i)}', []>`, '', `export const resource${i} = defineContract<Prefix>()({`)
  for (const t of templates) {
    let chain = `  ${t.key}: endpoint.${t.method}('${t.path}')`
    if (t.query === 'index') chain += '.query(IndexQuerySchema)'
    if (t.query === 'search') chain += '.query(SearchQuerySchema)'
    if (t.body === 'create') chain += '.body(CreateBodySchema)'
    if (t.body === 'update') chain += '.body(UpdateBodySchema)'
    if (t.headers) chain += '.headers(ExportHeadersSchema)'
    if (t.response === 'item') chain += `.response(ResourceSchema${t.status ? `, ${t.status}` : ''})`
    if (t.response === 'list') chain += `.response(ResourceListSchema${t.status ? `, ${t.status}` : ''})`
    if (t.response === 'stats') chain += `.response(StatsSchema${t.status ? `, ${t.status}` : ''})`
    if (!t.response && t.status) chain += `.status(${t.status})`
    if (t.public) chain += '.public()'
    if (t.authorize) chain += '.authorize()'
    if (t.throttle === false) chain += '.throttle(false)'
    if (t.throws) chain += `.throws(${t.throws.join(', ')})`
    lines.push(`${chain},`)
  }
  lines.push("}, { auth: true, throttle: { limit: 60, per: '1m' } })", '')
  return lines.join('\n')
}

/**
 * The controller of one contract. Every handler takes the typed ctx and returns the response schema
 * input, so `r.contract()` runs the full route proof on it.
 * @param {number} i
 * @param {readonly Template[]} templates
 */
const controllerFile = (i, templates) => {
  const resourceType = `Resource${i}`
  const stats = `Stats${i}`
  const types = [resourceType, ...(templates.some((t) => t.response === 'stats') ? [stats] : [])]
  const lines = [
    "import { Controller } from '@laratype/http'",
    "import type { Ctx } from '@laratype/http'",
    `import { resource${i} } from '../contracts/resource-${i}'`,
    `import type { ${types.join(', ')} } from '../contracts/resource-${i}'`,
    '',
    `export class Resource${i}Controller extends Controller {`,
  ]
  for (const t of templates) {
    const signature = `  ${t.key}(ctx: Ctx<typeof resource${i}.${t.key}>) {`
    if (t.response === 'item') lines.push(signature, `    return {} as ${resourceType}`, '  }')
    else if (t.response === 'list') lines.push(signature, `    return [] as ${resourceType}[]`, '  }')
    else if (t.response === 'stats') lines.push(signature, `    return {} as ${stats}`, '  }')
    else lines.push(`  ${t.key}(ctx: Ctx<typeof resource${i}.${t.key}>) {}`)
  }
  lines.push('}', '')
  return lines.join('\n')
}

/** @param {Template} t */
const clientArgs = (t) => {
  switch (t.key) {
    case 'index':
      return '{ params: { team }, query: { page: 1 } }'
    case 'show':
      return '{ params: { team, id: 1 } }'
    case 'store':
      return "{ params: { team }, body: { name: 'name', email: 'user@example.com' } }"
    case 'update':
      return '{ params: { team, id: 1 }, body: {} }'
    case 'destroy':
      return '{ params: { team, id: 1 } }'
    case 'search':
      return "{ params: { team }, query: { q: 'query' } }"
    case 'stats':
      return '{ params: { team } }'
    case 'archive':
      return '{ params: { team, id: 1 } }'
    case 'export':
      return "{ params: { team }, headers: { 'x-api-key': 'key' } }"
    case 'restore':
      return '{ params: { team, id: 1 } }'
    default:
      throw new Error(`bench-types: no client call for endpoint template "${t.key}"`)
  }
}

/**
 * The client usage: one call per endpoint, with the result narrowed by `ok`, so the full
 * `ClientResult` union is instantiated (not just the call argument).
 * @param {number} contractCount
 * @param {readonly (readonly Template[])[]} perContract
 */
const clientFile = (contractCount, perContract) => {
  const lines = [
    "import { createClient } from '@laratype/client'",
    "import { appApi } from './app-api'",
    '',
    "const api = createClient(appApi, { baseUrl: 'https://example.com' })",
    '',
    'let sink = 0',
    '',
  ]
  for (let i = 0; i < contractCount; i++) {
    lines.push(`async function run${i}() {`, `  const team = 'team-${i}'`)
    for (const t of perContract[i]) {
      const result = `r${i}_${t.key}`
      lines.push(`  const ${result} = await api.resource${i}.${t.key}(${clientArgs(t)})`)
      lines.push(`  if (${result}.ok) sink += String(${result}.data).length`)
      lines.push(`  else sink += String(${result}.code).length`)
    }
    lines.push('}', '')
  }
  lines.push('export async function exercise() {')
  for (let i = 0; i < contractCount; i++) lines.push(`  await run${i}()`)
  lines.push('  return sink', '}', '')
  return lines.join('\n')
}

/**
 * One `defineApi` module for a group of contracts.
 * @param {readonly number[]} indices @param {string} exportName
 */
const apiFile = (indices, exportName) => {
  const lines = [
    "import { defineApi } from '@laratype/contract'",
    ...indices.map((i) => `import { resource${i} } from './contracts/resource-${i}'`),
    '',
    `export const ${exportName} = defineApi({`,
  ]
  for (const i of indices) lines.push(`  resource${i}: { contract: resource${i}, path: '${prefixOf(i)}', scopes: [] },`)
  lines.push('})', '')
  return lines.join('\n')
}

/**
 * All files of the fixture, as `path -> content`.
 * @param {number} endpoints
 */
export function generateFixture(endpoints) {
  if (!Number.isInteger(endpoints) || endpoints < TEMPLATES.length) {
    throw new Error(`bench-types: endpoints must be an integer >= ${TEMPLATES.length}, got ${endpoints}`)
  }
  const contractCount = Math.ceil(endpoints / ENDPOINTS_PER_CONTRACT)
  /** @type {(readonly Template[])[]} */
  const perContract = []
  for (let i = 0; i < contractCount; i++) {
    perContract.push(TEMPLATES.slice(0, Math.min(ENDPOINTS_PER_CONTRACT, endpoints - i * ENDPOINTS_PER_CONTRACT)))
  }

  /** @type {Map<string, string>} */
  const files = new Map()
  files.set('errors.ts', ERRORS_FILE)
  files.set('schema.ts', SCHEMA_FILE)
  for (let i = 0; i < contractCount; i++) {
    files.set(`contracts/resource-${i}.ts`, contractFile(i, perContract[i]))
    files.set(`controllers/resource-${i}.ts`, controllerFile(i, perContract[i]))
  }
  const allIndices = Array.from({ length: contractCount }, (_, i) => i)
  files.set('app-api.ts', apiFile(allIndices, 'appApi'))
  const groups = []
  for (let start = 0; start < contractCount; start += CONTRACTS_PER_ROUTE_GROUP) {
    groups.push({ start, end: Math.min(contractCount, start + CONTRACTS_PER_ROUTE_GROUP) })
  }
  for (const [group, range] of groups.entries()) {
    files.set(`app-api-${group}.ts`, apiFile(allIndices.slice(range.start, range.end), `appApi${group}`))
  }

  // `routes.ts` imports these same modules, so `routes - controllers` measures only Route.api/r.contract().
  files.set(
    'controllers.ts',
    [
      ...groups.map((_, group) => `export { appApi${group} } from './app-api-${group}'`),
      ...Array.from({ length: contractCount }, (_, i) => `export { Resource${i}Controller } from './controllers/resource-${i}'`),
    ].join('\n') + '\n',
  )

  const routeLines = [
    "import { Route } from '@laratype/http'",
    ...groups.map((_, group) => `import { appApi${group} } from './app-api-${group}'`),
    ...allIndices.map((i) => `import { resource${i} } from './contracts/resource-${i}'`),
    ...allIndices.map((i) => `import { Resource${i}Controller } from './controllers/resource-${i}'`),
    '',
    '/** The policy of the endpoints with .authorize(): `before` covers every one. */',
    'class BenchPolicy {',
    '  before() {',
    '    return true',
    '  }',
    '}',
    '',
    'export const routes = [',
  ]
  for (const [group, range] of groups.entries()) {
    routeLines.push(`  Route.api(appApi${group}, (r) => [`)
    for (let i = range.start; i < range.end; i++) routeLines.push(`    r.contract(resource${i}, Resource${i}Controller, { policy: BenchPolicy }),`)
    routeLines.push('  ]),')
  }
  routeLines.push(']', '')
  files.set('routes.ts', routeLines.join('\n'))

  files.set('client.ts', clientFile(contractCount, perContract))

  return { contractCount, files }
}
