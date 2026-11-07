// @ts-check
// Type-performance benchmark (S6 #95): generates a small Laratype app of N endpoints, runs
// `tsc --extendedDiagnostics` on it and prints check time, instantiations and memory.
//
// Usage: bun run bench:types
//   BENCH_TYPES_MAX_MS  threshold for the app @ 500 endpoints check time (default 3000)
//   BENCH_TYPES_NODE    Node binary that runs tsc (default node)
//
// The fixture lives in .bench-types/ (gitignored), is regenerated on every run and is never shipped.
// CI runs it in .github/workflows/type-bench.yml: see docs/v1/build.md › Type-performance benchmark.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateFixture } from './fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tscPath = path.join(root, 'node_modules/typescript/lib/tsc.js')
const cacheRoot = path.join(root, '.bench-types')
const DEFAULT_MAX_MS = 3000
/** Two runs per case; `check` is the lower one, since page-cache and CPU load move a single sample. */
const RUNS = 2
/** tsc runs under Node, the runtime of a user's `tsc`; override with BENCH_TYPES_NODE for another binary. */
const nodeBin = process.env.BENCH_TYPES_NODE ?? 'node'
const tscLabel = path.relative(root, tscPath).replaceAll('\\', '/')

/**
 * The cases of the table. `app` is the FE program (contracts + `createClient` usage), which must not load
 * server modules; `controllers` is the server graph without the router (contracts + controllers); `routes`
 * adds `Route.api`/`r.contract()`, so the route proof is the difference between the two. Sizes 100 / 500 /
 * 1000 are recorded; the route proof is also measured at 50.
 */
const CASES = [
  { scenario: 'app', endpoints: 100, entry: 'client.ts', globals: false },
  { scenario: 'app', endpoints: 500, entry: 'client.ts', globals: false },
  { scenario: 'app', endpoints: 1000, entry: 'client.ts', globals: false },
  { scenario: 'controllers', endpoints: 50, entry: 'controllers.ts', globals: true },
  { scenario: 'controllers', endpoints: 100, entry: 'controllers.ts', globals: true },
  { scenario: 'controllers', endpoints: 500, entry: 'controllers.ts', globals: true },
  { scenario: 'controllers', endpoints: 1000, entry: 'controllers.ts', globals: true },
  { scenario: 'routes', endpoints: 50, entry: 'routes.ts', globals: true },
  { scenario: 'routes', endpoints: 500, entry: 'routes.ts', globals: true },
]

/** Mirrors tsconfig.app.json (paths, strict, decorators); keep the two in sync. */
const COMPILER_OPTIONS = {
  baseUrl: root.replaceAll('\\', '/'),
  target: 'ES2022',
  module: 'ES2022',
  moduleResolution: 'node',
  lib: ['ES2022', 'DOM'],
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  paths: { '@laratype/*': ['packages/*/src'] },
}

/**
 * Runs a child process and returns its output plus the wall time.
 * @param {string} command @param {readonly string[]} args
 */
const run = (command, args) => {
  const started = process.hrtime.bigint()
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180_000 })
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6
  return { ...result, wallMs }
}

/** @param {string} output @param {string} label */
const durationMs = (output, label) => {
  const match = output.match(new RegExp(`^${label}:\\s+([\\d.]+)s$`, 'm'))
  return match ? Number.parseFloat(match[1]) * 1000 : undefined
}

/** @param {string} output @param {string} label */
const metric = (output, label) => {
  const match = output.match(new RegExp(`^${label}:\\s+([\\d,]+)`, 'm'))
  return match ? Number.parseInt(match[1].replaceAll(',', ''), 10) : undefined
}

/** @param {string} output */
const memoryKb = (output) => {
  const kb = output.match(/^Memory used:\s+([\d,]+)K$/m)
  if (kb) return Number.parseInt(kb[1].replaceAll(',', ''), 10)
  const bytes = output.match(/^Memory used:\s+([\d,]+)\s+bytes$/m)
  return bytes ? Math.round(Number.parseInt(bytes[1].replaceAll(',', ''), 10) / 1024) : undefined
}

/** @param {number | undefined} ms */
const seconds = (ms) => (ms === undefined ? '?' : `${(ms / 1000).toFixed(2)}s`)

/** @param {number | undefined} kb */
const megabytes = (kb) => (kb === undefined ? '?' : `${(kb / 1024).toFixed(1)} MB`)

/** @param {string} output */
const errorLines = (output) =>
  output
    .split(/\r?\n/)
    .filter((line) => line.includes('error TS'))
    .slice(0, 20)

/** @param {string} output */
const tail = (output) => output.split(/\r?\n/).filter(Boolean).slice(-30).join('\n')

/**
 * Generates one case and writes its tsconfig. Returns the tsconfig path and contract count.
 * @param {{ scenario: string, endpoints: number, entry: string, globals: boolean }} testCase
 * @param {string} runRoot
 */
const writeCase = (testCase, runRoot) => {
  const dir = path.join(runRoot, `${testCase.scenario}-${testCase.endpoints}`)
  const { contractCount, files } = generateFixture(testCase.endpoints)
  for (const [relative, content] of files) {
    const target = path.join(dir, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const include = [testCase.entry]
  if (testCase.globals) {
    include.push(path.join(root, 'packages/global.d.ts'), path.join(root, 'packages/http/src/overload.d.ts'))
  }
  const tsconfig = path.join(dir, 'tsconfig.json')
  // The FE program gets no Node types (the contract stays browser-pure); the server program gets them.
  const compilerOptions = { ...COMPILER_OPTIONS, types: testCase.globals ? ['node'] : [] }
  writeFileSync(tsconfig, `${JSON.stringify({ compilerOptions, include: include.map((file) => file.replaceAll('\\', '/')) }, null, 2)}\n`)
  return { tsconfig, contractCount }
}

/**
 * Runs tsc on one case. Returns the result, or `undefined` after printing why the run failed.
 * @param {{ scenario: string, endpoints: number, entry: string, globals: boolean }} testCase
 * @param {string} tsconfig @param {number} contractCount
 */
const measure = (testCase, tsconfig, contractCount) => {
  let best
  for (let attempt = 0; attempt < RUNS; attempt++) {
    const output = run(nodeBin, [tscPath, '-p', tsconfig, '--extendedDiagnostics', '--pretty', 'false'])
    const text = `${output.stdout ?? ''}${output.stderr ?? ''}`
    if (output.status !== 0) {
      const lines = errorLines(text)
      const why = output.error?.message ?? (output.signal ? `signal ${output.signal}` : `exit ${output.status}`)
      console.error(`bench-types: tsc failed for ${testCase.scenario} @ ${testCase.endpoints} endpoints (${why})`)
      console.error(lines.length ? lines.join('\n') : tail(text))
      return undefined
    }
    const checkMs = durationMs(text, 'Check time')
    if (checkMs === undefined) {
      console.error(`bench-types: no "Check time" line in the tsc output for ${testCase.scenario} @ ${testCase.endpoints} endpoints`)
      console.error(tail(text))
      return undefined
    }
    const result = {
      scenario: testCase.scenario,
      endpoints: testCase.endpoints,
      contracts: contractCount,
      files: metric(text, 'Files'),
      checkMs,
      totalMs: durationMs(text, 'Total time'),
      instantiations: metric(text, 'Instantiations'),
      memoryKb: memoryKb(text),
      wallMs: output.wallMs,
    }
    if (best === undefined || result.checkMs < best.checkMs) best = result
  }
  return best
}

const main = () => {
  if (!existsSync(tscPath)) {
    console.error(`bench-types: TypeScript not found at ${tscLabel}. Run "bun install" in the repo root first.`)
    return 1
  }
  const raw = process.env.BENCH_TYPES_MAX_MS
  const maxMs = raw === undefined || raw === '' ? DEFAULT_MAX_MS : Number(raw)
  if (!Number.isFinite(maxMs) || maxMs <= 0) {
    console.error(`bench-types: BENCH_TYPES_MAX_MS must be a positive number of milliseconds, got ${JSON.stringify(raw)}`)
    return 1
  }

  const version = run(nodeBin, [tscPath, '--version'])
  if (version.error || version.status !== 0) {
    const why = version.error?.message ?? (version.signal ? `signal ${version.signal}` : `exit ${version.status}`)
    console.error(`bench-types: could not run ${nodeBin} ${tscLabel} --version: ${why}`)
    return 1
  }
  const tscVersion = (version.stdout ?? '').trim().replace(/^Version\s+/i, '') || 'unknown'

  mkdirSync(cacheRoot, { recursive: true })
  const runRoot = mkdtempSync(path.join(cacheRoot, 'run-'))
  try {
    console.log(`Laratype type-performance benchmark (S6 #95) · tsc ${tscVersion}`)
    console.log('case app: contracts + createClient (FE) · controllers: contracts + controllers (server) · routes: controllers + Route.api/r.contract() (server)')
    console.log(`fixture: ${path.relative(root, runRoot).replaceAll('\\', '/')}/<case> · ${CASES.length} cases · ${RUNS} runs each, check = lower\n`)

    /** @type {{ scenario: string, endpoints: number, contracts: number, files?: number, checkMs: number, totalMs?: number, instantiations?: number, memoryKb?: number, wallMs: number }[]} */
    const results = []
    for (const testCase of CASES) {
      const { tsconfig, contractCount } = writeCase(testCase, runRoot)
      const result = measure(testCase, tsconfig, contractCount)
      if (result === undefined) return 1
      results.push(result)
    }

    const header = ['case', 'endpoints', 'contracts', 'files', 'check', 'total', 'instantiations', 'memory', 'wall']
    const rows = results.map((r) => [
      r.scenario,
      String(r.endpoints),
      String(r.contracts),
      String(r.files ?? '?'),
      seconds(r.checkMs),
      seconds(r.totalMs),
      String(r.instantiations ?? '?'),
      megabytes(r.memoryKb),
      seconds(r.wallMs),
    ])
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)))
    const format = (/** @type {readonly string[]} */ cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ')
    console.log(format(header))
    console.log(widths.map((width) => '-'.repeat(width)).join('  '))
    for (const row of rows) console.log(format(row))
    console.log('\ncheck / total: tsc --extendedDiagnostics (lower of two runs for check). Threshold: app @ 500 endpoints check time.')

    const app500 = results.find((r) => r.scenario === 'app' && r.endpoints === 500)
    if (!app500) {
      console.error('\nbench-types: no app @ 500 endpoints result to compare against the threshold')
      return 1
    }
    const passed = app500.checkMs < maxMs
    const limit = maxMs < 1000 ? `${maxMs} ms` : seconds(maxMs)
    console.log(`\nThreshold: app @ 500 endpoints check time ${seconds(app500.checkMs)} ${passed ? '<' : '>='} ${limit} (BENCH_TYPES_MAX_MS=${maxMs}): ${passed ? 'pass' : 'FAIL'}`)
    const routes500 = results.find((r) => r.scenario === 'routes' && r.endpoints === 500)
    if (routes500 && routes500.checkMs >= maxMs) {
      console.log(`Note: routes @ 500 endpoints is ${seconds(routes500.checkMs)} (recorded only, not gated; see docs/v1/build.md).`)
    }
    return passed ? 0 : 1
  } finally {
    rmSync(runRoot, { recursive: true, force: true })
  }
}

process.exitCode = main()
