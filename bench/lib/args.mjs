/**
 * Command-line and environment parsing for the phase-1 benchmark runner.
 *
 * Pure: no process spawn, no network, no filesystem. `bench/run.mjs` applies the result, and
 * `bench/__tests__/args.test.mjs` exercises it without starting a server or a load generator.
 *
 * Flags win over `BENCH_*` environment variables, which is how CI passes the dispatch inputs.
 * `--smoke` always runs a 1 s autocannon profile with no warm-up.
 */

export const APPS = Object.freeze(['laratype', 'hono', 'express', 'fastify'])
export const RUNTIMES = Object.freeze(['node', 'bun'])

export const DEFAULTS = Object.freeze({
  apps: APPS,
  runtimes: RUNTIMES,
  scenario: null,
  connections: 50,
  duration: 10,
  warmup: 2,
  smoke: false,
  node: 'node',
  bun: 'bun',
  allowNodeMismatch: false,
})

/** A bad flag or environment value: the runner prints it and exits 1, never a stack trace. */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

const list = (name, value) => {
  const items = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (items.length === 0) throw new UsageError(`bench: ${name} needs at least one value`)
  return items
}

const number = (name, value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new UsageError(`bench: ${name} needs a non-negative number`)
  return parsed
}

const envValue = (env, name) => {
  const value = env[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Parse `argv` (without the executable and script) and the `BENCH_*` environment.
 *
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, defaultOut: string }} options
 * @returns {{
 *   apps: string[], runtimes: string[], scenario: string | null, connections: number,
 *   duration: number, warmup: number, smoke: boolean, out: string, node: string, bun: string,
 *   allowNodeMismatch: boolean, help: boolean
 * }}
 */
export function parseArgs(argv, { env = {}, defaultOut } = {}) {
  if (typeof defaultOut !== 'string' || defaultOut === '') throw new TypeError('parseArgs needs a defaultOut path')

  const opts = {
    apps: [...DEFAULTS.apps],
    runtimes: [...DEFAULTS.runtimes],
    scenario: DEFAULTS.scenario,
    connections: DEFAULTS.connections,
    duration: DEFAULTS.duration,
    warmup: DEFAULTS.warmup,
    smoke: DEFAULTS.smoke,
    out: defaultOut,
    node: envValue(env, 'BENCH_NODE') ?? DEFAULTS.node,
    bun: envValue(env, 'BENCH_BUN') ?? DEFAULTS.bun,
    allowNodeMismatch: env.BENCH_ALLOW_NODE_MISMATCH === '1',
    help: false,
  }

  if (envValue(env, 'BENCH_APPS') !== undefined) opts.apps = list('BENCH_APPS', envValue(env, 'BENCH_APPS'))
  if (envValue(env, 'BENCH_RUNTIMES') !== undefined) opts.runtimes = list('BENCH_RUNTIMES', envValue(env, 'BENCH_RUNTIMES'))
  if (envValue(env, 'BENCH_SCENARIO') !== undefined) opts.scenario = envValue(env, 'BENCH_SCENARIO')
  if (envValue(env, 'BENCH_CONNECTIONS') !== undefined) opts.connections = number('BENCH_CONNECTIONS', envValue(env, 'BENCH_CONNECTIONS'))
  if (envValue(env, 'BENCH_DURATION') !== undefined) opts.duration = number('BENCH_DURATION', envValue(env, 'BENCH_DURATION'))
  if (envValue(env, 'BENCH_WARMUP') !== undefined) opts.warmup = number('BENCH_WARMUP', envValue(env, 'BENCH_WARMUP'))
  if (envValue(env, 'BENCH_OUT') !== undefined) opts.out = envValue(env, 'BENCH_OUT')

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new UsageError(`bench: ${arg} needs a value`)
      i++
      return next
    }
    if (arg === '--smoke') opts.smoke = true
    else if (arg === '--apps') opts.apps = list('--apps', value())
    else if (arg === '--runtimes') opts.runtimes = list('--runtimes', value())
    else if (arg === '--scenario') opts.scenario = value()
    else if (arg === '--connections') opts.connections = number('--connections', value())
    else if (arg === '--duration') opts.duration = number('--duration', value())
    else if (arg === '--warmup') opts.warmup = number('--warmup', value())
    else if (arg === '--out') opts.out = value()
    else if (arg === '--node') opts.node = value()
    else if (arg === '--bun') opts.bun = value()
    else if (arg === '--allow-node-mismatch') opts.allowNodeMismatch = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else throw new UsageError(`bench: unknown argument ${arg}`)
  }

  for (const app of opts.apps) if (!APPS.includes(app)) throw new UsageError(`bench: unknown app ${app} (${APPS.join(', ')})`)
  for (const runtime of opts.runtimes) if (!RUNTIMES.includes(runtime)) throw new UsageError(`bench: unknown runtime ${runtime} (${RUNTIMES.join(', ')})`)

  if (opts.smoke) {
    opts.duration = 1
    opts.warmup = 0
  }
  return opts
}

/** The two usage lines printed by `--help` and after a `UsageError`. */
export const usageLines = Object.freeze([
  'usage: bun bench/run.mjs [--apps a,b] [--runtimes node,bun] [--scenario name] [--connections n]',
  '       [--duration s] [--warmup s] [--smoke] [--node path] [--bun path] [--out dir] [--allow-node-mismatch]',
])
