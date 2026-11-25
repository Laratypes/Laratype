#!/usr/bin/env node
/**
 * Phase-1 runtime benchmark runner (#353).
 *
 * Spawns one server at a time (never imports it), on a free port bound to 127.0.0.1, health-checks it, discards a
 * warm-up autocannon run, measures req/s + p50/p99 + RSS, kills it and awaits its exit before the next run. Autocannon
 * always runs on Node (never on the Bun under test), so the generator is constant. Output is a JSON + Markdown report
 * under bench/out (gitignored).
 *
 * **Run it only in bench/Dockerfile or the `bench` GitHub workflow, never on a developer machine.** The pure helpers
 * (flags, report, wire fixtures, commit fallback) live in bench/lib and are covered by `bench/__tests__`.
 *
 * Usage: bun bench/run.mjs [--apps ...] [--runtimes node,bun] [--scenario name] [--connections 50] [--duration 10]
 *        [--warmup 2] [--smoke] [--node <path>] [--bun <path>] [--out <dir>] [--allow-node-mismatch]
 *
 * Every flag has a `BENCH_*` environment variable (the CI dispatch inputs): `BENCH_APPS`, `BENCH_RUNTIMES`,
 * `BENCH_SCENARIO`, `BENCH_CONNECTIONS`, `BENCH_DURATION`, `BENCH_WARMUP`, `BENCH_OUT`, `BENCH_NODE`, `BENCH_BUN`.
 * `BENCH_ALLOW_NODE_MISMATCH=1` is the env form of `--allow-node-mismatch`, and `BENCH_GIT_SHA` / `BENCH_GIT_BRANCH` /
 * `BENCH_GIT_DIRTY=1` replace git metadata when the build context has no `.git` (the Docker image). Flags win over the
 * environment. `--smoke` also honours `--apps` / `--runtimes` and always uses a 1 s autocannon run.
 */
import { spawn, spawnSync, execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scenarios, skipped } from './scenarios.mjs'
import { parseArgs, usageLines, UsageError } from './lib/args.mjs'
import { resolveGitInfo } from './lib/git-info.mjs'
import { buildReport, markdown, reportBaseName, round } from './lib/report.mjs'
import { autocannonArgs, requestFor, responseMatches } from './lib/wire.mjs'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const execFileP = promisify(execFile)

const usage = () => {
  for (const line of usageLines) console.error(line)
}

let opts
try {
  opts = parseArgs(process.argv.slice(2), { env: process.env, defaultOut: path.join(here, 'out') })
} catch (error) {
  if (!(error instanceof UsageError)) throw error
  console.error(error.message)
  usage()
  process.exit(1)
}
if (opts.help) {
  usage()
  process.exit(0)
}
opts.out = path.resolve(opts.out)

const selected = opts.scenario ? scenarios.filter((scenario) => scenario.name === opts.scenario) : scenarios
if (selected.length === 0) fail(`bench: unknown scenario ${opts.scenario} (${scenarios.map((s) => s.name).join(', ')})`)

function fail(message) {
  console.error(message)
  process.exit(1)
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}:\n${result.stderr}`)
  return result.stdout.trim()
}

const readGitInfo = () => ({
  sha: capture('git', ['rev-parse', 'HEAD']),
  branch: capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
  dirty: capture('git', ['status', '--porcelain']).length > 0,
})

// The Docker build context has no .git: CI passes the checked-out commit as BENCH_GIT_* (bench/README.md).
const commit = resolveGitInfo(process.env, readGitInfo)

const packageVersion = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8')).version

function installedVersion(name) {
  const candidates = [
    path.join(here, 'node_modules', name, 'package.json'),
    path.join(root, 'node_modules', name, 'package.json'),
  ]
  const file = candidates.find((candidate) => existsSync(candidate))
  if (!file) throw new Error(`bench: ${name} is not installed; run bun install --ignore-scripts --minimum-release-age=1209600`)
  return JSON.parse(readFileSync(file, 'utf8')).version
}

const nodeVersion = capture(opts.node, ['--version'])
const bunVersion = opts.runtimes.includes('bun') ? capture(opts.bun, ['--version']) : null
const expectedNode = readFileSync(path.join(root, '.node-version'), 'utf8').trim()

if (nodeVersion !== `v${expectedNode}`) {
  const message = `bench: Node ${nodeVersion} does not match .node-version (v${expectedNode})`
  if (!opts.allowNodeMismatch) fail(`${message}; pass --allow-node-mismatch to run anyway (recorded in the report)`)
  console.warn(`${message}; continuing because --allow-node-mismatch is set`)
}

if (!existsSync(path.join(root, 'packages/http/dist/index.esm.js'))) {
  console.log('bench: packages/http/dist is missing; running bun run build first (not timed)')
  const build = spawnSync(opts.bun, ['run', 'build'], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (build.status !== 0) fail('bench: bun run build failed')
}

const autocannonPackage = require.resolve('autocannon/package.json')
const autocannonMeta = JSON.parse(readFileSync(autocannonPackage, 'utf8'))
const autocannonBin = path.resolve(
  path.dirname(autocannonPackage),
  typeof autocannonMeta.bin === 'string' ? autocannonMeta.bin : autocannonMeta.bin?.autocannon,
)
if (!existsSync(autocannonBin)) fail(`bench: cannot find the autocannon CLI at ${autocannonBin}`)

const frameworkVersions = {
  laratype: `${packageVersion('packages/http/package.json')} (workspace packages/http; v1 API on ${commit.sha})`,
  hono: installedVersion('hono'),
  '@hono/node-server': installedVersion('@hono/node-server'),
  express: installedVersion('express'),
  fastify: installedVersion('fastify'),
  zod: installedVersion('zod'),
  autocannon: installedVersion('autocannon'),
  dayjs: installedVersion('dayjs'),
}

const machine = {
  platform: os.platform(),
  release: os.release(),
  arch: os.arch(),
  cpu: os.cpus()[0]?.model ?? 'unknown',
  cores: os.cpus().length,
  memoryBytes: os.totalmem(),
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

const liveChildren = new Set()

process.on('exit', () => {
  for (const child of liveChildren) {
    try {
      if (child.exitCode === null) child.kill('SIGKILL')
    } catch {}
  }
})

function startServer(app, runtime, port) {
  const command = runtime === 'bun' ? opts.bun : opts.node
  const cwd = path.join(here, 'apps', app)
  const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port) }
  const startedAt = process.hrtime.bigint()
  const child = spawn(command, ['entry.mjs'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  liveChildren.add(child)
  const state = {
    child,
    startedAt,
    stdout: '',
    stderr: '',
    exit: null,
    command: { command, args: ['entry.mjs'], cwd, env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port) } },
  }
  const append = (key, chunk) => {
    state[key] = (state[key] + chunk).slice(-8192)
  }
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => append('stdout', chunk))
  child.stderr?.on('data', (chunk) => append('stderr', chunk))
  child.once('exit', (code, signal) => {
    state.exit = { code, signal }
    liveChildren.delete(child)
  })
  child.once('error', (error) => {
    state.exit = state.exit ?? { code: null, signal: null, error: String(error) }
    liveChildren.delete(child)
  })
  return state
}

const elapsedMs = (startedAt) => Number(process.hrtime.bigint() - startedAt) / 1e6

async function waitForHealth(state, port) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (state.exit) {
      throw new Error(`server exited before /health (code ${state.exit.code}, signal ${state.exit.signal}):\n${state.stderr}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) })
      if (response.status === 200) return
    } catch {}
    await delay(10)
  }
  throw new Error(`/health did not answer 200 within 15000 ms:\n${state.stderr}`)
}

function waitExit(state, timeoutMs) {
  return new Promise((resolve) => {
    if (state.exit) return resolve(true)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      state.child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    state.child.once('exit', onExit)
  })
}

async function stopServer(state) {
  if (!state || state.exit) return
  state.child.kill('SIGTERM')
  if (await waitExit(state, 5000)) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(state.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    state.child.kill('SIGKILL')
  }
  await waitExit(state, 5000)
}

async function bootServer(app, runtime) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await freePort()
    const state = startServer(app, runtime, port)
    try {
      await waitForHealth(state, port)
      return { state, port, coldStartMs: elapsedMs(state.startedAt) }
    } catch (error) {
      await stopServer(state)
      const text = `${error.message}\n${state.stderr}`
      if (attempt < 2 && /EADDRINUSE|address already in use/i.test(text)) continue
      error.stderrTail = state.stderr
      throw error
    }
  }
  throw new Error('bench: could not bind a free port after 3 attempts')
}

const bodyFile = (scenario) => {
  const file = path.join(opts.out, 'tmp', `${scenario.name}.json`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(scenario.body))
  return file
}

function runAutocannon(scenario, port, duration) {
  return new Promise((resolve, reject) => {
    const args = [
      autocannonBin,
      ...autocannonArgs(scenario, {
        port,
        connections: opts.connections,
        duration,
        bodyFile: scenario.body ? bodyFile(scenario) : undefined,
      }),
    ]
    const child = spawn(opts.node, args, {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-1_000_000)
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-16384)
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`autocannon timed out after ${duration + 60}s:\n${stderr}`))
    }, (duration + 60) * 1000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`autocannon exited ${code}:\n${stderr || stdout}`))
      const start = stdout.indexOf('{')
      const end = stdout.lastIndexOf('}')
      if (start === -1 || end <= start) return reject(new Error(`autocannon printed no JSON:\n${stdout}\n${stderr}`))
      try {
        resolve(JSON.parse(stdout.slice(start, end + 1)))
      } catch (error) {
        reject(new Error(`autocannon JSON parse failed: ${error.message}\n${stdout}`))
      }
    })
  })
}

async function sampleRss(pid) {
  try {
    if (process.platform === 'linux') {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8')
      const match = status.match(/VmRSS:\s+(\d+)\s+kB/)
      return match ? Number(match[1]) * 1024 : null
    }
    if (process.platform === 'win32') {
      const { stdout } = await execFileP('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { timeout: 4000, windowsHide: true })
      const line = stdout.split(/\r?\n/).find((row) => row.includes(`"${pid}"`))
      if (!line) return null
      const fields = line.match(/"([^"]*)"/g)?.map((field) => field.slice(1, -1)) ?? []
      const kb = Number((fields.at(-1) ?? '').replace(/[^\d]/g, ''))
      return Number.isFinite(kb) && kb > 0 ? kb * 1024 : null
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFileP('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 4000 })
      const kb = Number(stdout.trim())
      return Number.isFinite(kb) && kb > 0 ? kb * 1024 : null
    }
  } catch {}
  return null
}

function startRssSampler(pid) {
  const samples = []
  let inFlight = false
  let stopped = false
  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const bytes = await sampleRss(pid)
      if (bytes !== null) samples.push(bytes)
    } finally {
      inFlight = false
    }
  }
  const timer = setInterval(tick, 500)
  return {
    async stop() {
      stopped = true
      clearInterval(timer)
      // Let an in-flight tasklist/ps sample land before the max is taken.
      for (let i = 0; i < 100 && inFlight; i++) await delay(50)
      return samples
    },
  }
}

function commandLine(state) {
  return [state.command.command, ...state.command.args].join(' ')
}

async function measure(app, runtime, scenario) {
  const { state, port, coldStartMs } = await bootServer(app, runtime)
  try {
    if (opts.warmup > 0) await runAutocannon(scenario, port, opts.warmup)
    const idleBytes = await sampleRss(state.child.pid)
    const sampler = startRssSampler(state.child.pid)
    let result
    let samples
    try {
      result = await runAutocannon(scenario, port, opts.duration)
    } finally {
      samples = await sampler.stop()
    }
    return {
      name: scenario.name,
      method: scenario.method,
      path: scenario.path,
      status: 'ok',
      requestsPerSec: round(result.requests?.average ?? 0),
      latencyMs: { p50: round(result.latency?.p50, 2), p99: round(result.latency?.p99, 2) },
      coldStartMs: round(coldStartMs),
      rssIdleBytes: idleBytes,
      rssUnderLoadBytes: samples.length ? Math.max(...samples) : null,
      errors: result.errors ?? 0,
      non2xx: result.non2xx ?? 0,
      timeouts: result.timeouts ?? 0,
      durationSec: result.duration ?? opts.duration,
      connections: result.connections ?? opts.connections,
      commandLine: commandLine(state),
      cwd: state.command.cwd,
      env: state.command.env,
    }
  } catch (error) {
    error.stderrTail = state.stderr
    throw error
  } finally {
    await stopServer(state)
  }
}

async function smoke() {
  const failures = []
  let checks = 0
  for (const app of opts.apps) {
    for (const runtime of opts.runtimes) {
      let state
      try {
        const boot = await bootServer(app, runtime)
        state = boot.state
        for (const scenario of selected) {
          const repeats = scenario.requests ?? 1
          for (let attempt = 1; attempt <= repeats; attempt++) {
            const [url, init] = requestFor(scenario, boot.port)
            const response = await fetch(url, init)
            const text = await response.text()
            const ok = responseMatches(scenario, response.status, text)
            checks++
            const suffix = repeats > 1 ? ` #${attempt}` : ''
            if (ok) {
              console.log(`PASS ${app}/${runtime} ${scenario.name}${suffix} ${response.status} ${text}`)
            } else {
              failures.push({ app, runtime, scenario: scenario.name, attempt, status: response.status, body: text, scenarioExpectedStatus: scenario.expectedStatus, expectedBody: scenario.expectedBody })
              console.log(`FAIL ${app}/${runtime} ${scenario.name}${suffix}: got ${response.status} ${text}`)
              console.log(`     expected ${scenario.expectedStatus} ${scenario.expectedBody}`)
            }
          }
        }
        const jsonScenario = scenarios.find((scenario) => scenario.name === 'json')
        const result = await runAutocannon(jsonScenario, boot.port, 1)
        const ok = (result.requests?.average ?? 0) > 0 && (result.errors ?? 0) === 0 && (result.non2xx ?? 0) === 0 && (result.timeouts ?? 0) === 0
        checks++
        if (ok) {
          console.log(`PASS ${app}/${runtime} autocannon 1s ${round(result.requests?.average ?? 0)} req/s, ${round(result.latency?.p50, 2)} ms p50, ${round(result.latency?.p99, 2)} ms p99, 0 errors`)
        } else {
          failures.push({ app, runtime, scenario: 'autocannon', errors: result.errors, non2xx: result.non2xx, timeouts: result.timeouts })
          console.log(`FAIL ${app}/${runtime} autocannon 1s: ${JSON.stringify({ errors: result.errors, non2xx: result.non2xx, timeouts: result.timeouts, requests: result.requests?.average })}`)
        }
      } catch (error) {
        failures.push({ app, runtime, error: error.message })
        console.log(`FAIL ${app}/${runtime}: ${error.message}`)
      } finally {
        await stopServer(state)
      }
    }
  }
  if (failures.length > 0) {
    console.log(`\nSMOKE FAILED: ${failures.length} of ${checks} checks failed`)
    for (const failure of failures) console.log(`  ${JSON.stringify(failure)}`)
    process.exitCode = 1
    return
  }
  console.log(`\nSMOKE PASSED: ${checks} checks across ${opts.apps.length * opts.runtimes.length} app/runtime combinations`)
}

async function benchmark() {
  const runs = []
  for (const app of opts.apps) {
    for (const runtime of opts.runtimes) {
      console.log(`bench: ${app} on ${runtime}`)
      const run = { app, runtime, status: 'ok', coldStartMs: null, rss: { idleBytes: null, underLoadMaxBytes: null }, scenarios: [] }
      for (const scenario of selected) {
        try {
          const result = await measure(app, runtime, scenario)
          run.scenarios.push(result)
          console.log(`  ${scenario.name}: ${result.requestsPerSec} req/s, p50 ${result.latencyMs.p50} ms, p99 ${result.latencyMs.p99} ms, cold ${result.coldStartMs} ms`)
        } catch (error) {
          run.status = 'failed'
          run.scenarios.push({ name: scenario.name, status: 'failed', error: error.message, stderrTail: error.stderrTail ?? null })
          console.log(`  ${scenario.name}: FAILED ${error.message}`)
        }
      }
      const first = run.scenarios.find((scenario) => scenario.status === 'ok')
      if (first) {
        run.coldStartMs = first.coldStartMs
        run.rss = { idleBytes: first.rssIdleBytes, underLoadMaxBytes: first.rssUnderLoadBytes }
      }
      runs.push(run)
    }
  }

  const report = buildReport({
    commit,
    machine,
    runtimes: { node: nodeVersion, bun: bunVersion },
    versions: frameworkVersions,
    settings: {
      connections: opts.connections,
      durationSec: opts.duration,
      warmupSec: opts.warmup,
      pipelining: 1,
      keepAlive: true,
      nodeEnv: 'production',
      host: '127.0.0.1',
      nodeFlags: [],
      bunFlags: [],
      generator: 'autocannon',
      generatorRuntime: 'node',
    },
    skipped,
    runs,
  })
  mkdirSync(opts.out, { recursive: true })
  const base = path.join(opts.out, reportBaseName(report.commit.sha, report.generatedAt))
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(`${base}.md`, `${markdown(report)}\n`)
  console.log(`\nbench: wrote ${base}.json\nbench: wrote ${base}.md`)
  if (runs.some((run) => run.status !== 'ok')) process.exitCode = 1
}

if (opts.smoke) await smoke()
else await benchmark()
