/**
 * Report building for the phase-1 benchmark runner.
 *
 * Pure: the runner samples the machine and the servers, then hands the values here. Importing this module starts
 * nothing, so `bench/__tests__/report.test.mjs` can check the JSON shape and every Markdown table without a server.
 */
import { scenarios } from '../scenarios.mjs'

export const REPORT_SCHEMA_VERSION = 1

const LABELS = { laratype: 'Laratype', hono: 'Hono', express: 'Express', fastify: 'Fastify' }

/** One decimal by default; `null` for a missing or non-finite measurement. */
export const round = (value, digits = 1) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null)

export const formatBytes = (bytes) =>
  bytes === null || bytes === undefined ? '—' : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * The JSON report. `generatedAt` is injectable so tests do not depend on the clock.
 */
export function buildReport({
  generatedAt = new Date().toISOString(),
  commit,
  machine,
  runtimes,
  versions,
  settings,
  skipped = [],
  runs,
}) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    commit,
    phase: '1 (hand-written Laratype production entry, not sauf build)',
    machine,
    runtimes,
    versions,
    settings,
    skipped,
    runs,
  }
}

/** `<short sha>-<UTC timestamp with : and . replaced>`: the JSON and Markdown share this base name. */
export function reportBaseName(sha, generatedAt) {
  const stamp = generatedAt.replace(/[:.]/g, '-')
  return `${(sha || 'unknown').slice(0, 12)}-${stamp}`
}

export function markdown(report) {
  const lines = []
  const runs = report.runs
  const columns = runs.map((run) => `${LABELS[run.app]} · ${run.runtime}`)
  const scenarioNames = scenarios.map((scenario) => scenario.name)
  const cell = (run, name, read) => {
    const scenario = run.scenarios.find((candidate) => candidate.name === name)
    return scenario && scenario.status === 'ok' ? read(scenario) : '—'
  }
  const metricTable = (title, read) => {
    lines.push(`### ${title}`)
    lines.push('')
    lines.push(`| Scenario | ${columns.join(' | ')} |`)
    lines.push(`|---|${columns.map(() => '---:').join('|')}|`)
    for (const name of scenarioNames) {
      lines.push(`| ${name} | ${runs.map((run) => cell(run, name, read)).join(' | ')} |`)
    }
    lines.push('')
  }

  lines.push('# Laratype phase-1 runtime benchmark')
  lines.push('')
  lines.push(`**Commit:** \`${report.commit.sha}\`${report.commit.dirty ? ' (dirty working tree)' : ''} on \`${report.commit.branch}\`  `)
  lines.push(`**Date:** ${report.generatedAt}  `)
  lines.push(`**Machine:** ${report.machine.cpu}, ${report.machine.cores} cores, ${(report.machine.memoryBytes / 1024 ** 3).toFixed(1)} GiB, ${report.machine.platform} ${report.machine.release} (${report.machine.arch})  `)
  lines.push(`**Runtimes:** Node ${report.runtimes.node}${report.runtimes.bun ? `, Bun ${report.runtimes.bun}` : ''}  `)
  lines.push(`**Versions:** ${Object.entries(report.versions).map(([name, version]) => `${name} ${version}`).join(', ')}  `)
  lines.push(`**Settings:** ${report.settings.connections} connections, ${report.settings.durationSec} s measured, ${report.settings.warmupSec} s warm-up discarded, pipelining ${report.settings.pipelining}, keep-alive on, host 127.0.0.1, one server process at a time.`)
  lines.push('')
  lines.push('**Generated in `bench/Dockerfile` (or the `bench` GitHub workflow), never on a developer machine.**')
  lines.push('')
  lines.push('**Phase 1 uses a hand-written Laratype production entry over `@hono/node-server` / `Bun.serve`, not `sauf build`** (B4 #128 / B6 #130 were unmerged at run time). The entry overrides only `RequestKernel.resolveRequest()` to drop the per-request `console.log` (`packages/http/src/request/Request.ts:599-600`); no other kernel method is overridden. Laratype\'s production-mode output validation is off (`NODE_ENV=production`).')
  lines.push('')
  lines.push('Every server binds `127.0.0.1`. Express keeps its default `etag` and disables `x-powered-by`; Fastify runs with `logger: false`; Hono and Laratype log nothing.')
  lines.push('')
  metricTable('Requests per second (higher is better)', (scenario) => `${scenario.requestsPerSec}`)
  metricTable('p50 latency, ms (lower is better)', (scenario) => `${scenario.latencyMs.p50}`)
  metricTable('p99 latency, ms (lower is better)', (scenario) => `${scenario.latencyMs.p99}`)
  lines.push('### Cold start and memory')
  lines.push('')
  lines.push('| App | Runtime | Cold start, ms | RSS idle | RSS under load | Status |')
  lines.push('|---|---|---:|---:|---:|---|')
  for (const run of runs) {
    lines.push(`| ${LABELS[run.app]} | ${run.runtime} | ${run.coldStartMs ?? '—'} | ${formatBytes(run.rss.idleBytes)} | ${formatBytes(run.rss.underLoadMaxBytes)} | ${run.status} |`)
  }
  lines.push('')
  lines.push('### Skipped')
  lines.push('')
  for (const item of report.skipped) lines.push(`- **${item.scenario}**: ${item.reason}`)
  lines.push('')
  const failed = runs.flatMap((run) => run.scenarios.filter((scenario) => scenario.status !== 'ok').map((scenario) => ({ run, scenario })))
  if (failed.length > 0) {
    lines.push('### Failures')
    lines.push('')
    for (const { run, scenario } of failed) lines.push(`- ${LABELS[run.app]} · ${run.runtime} · ${scenario.name}: ${scenario.error ?? 'failed'}`)
    lines.push('')
  }
  lines.push('### Notes')
  lines.push('')
  lines.push('- `validation-422` answers 422 by design, so its autocannon `non2xx` count equals its response count; it is not an error.')
  lines.push('- Express/Fastify on Bun run through Bun\'s node:http compatibility layer, their only Bun path; Hono/Laratype use `Bun.serve`.')
  lines.push('- RSS is the child pid\'s OS value (`/proc/<pid>/status` on Linux, `tasklist` on Windows, `ps` on macOS), sampled every 500 ms.')
  lines.push('- The bench resolves `@hono/node-server` 2.1.7 (patched for GHSA-rmxm-3fg6-px4f), the same version as the root and `sauf` workspaces.')
  return lines.join('\n')
}
