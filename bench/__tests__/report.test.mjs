import { describe, expect, it } from 'vitest'
import { buildReport, formatBytes, markdown, REPORT_SCHEMA_VERSION, reportBaseName, round } from '../lib/report.mjs'

const generatedAt = '2026-11-25T12:34:56.789Z'

const report = buildReport({
  generatedAt,
  commit: { sha: '0123456789abcdef0123456789abcdef01234567', branch: 'build/b26-bench-phase1', dirty: false },
  machine: { platform: 'linux', release: '6.8.0', arch: 'x64', cpu: 'Test CPU', cores: 8, memoryBytes: 16 * 1024 ** 3 },
  runtimes: { node: 'v22.23.5', bun: '1.3.14' },
  versions: { hono: '4.13.17', express: '5.3.0' },
  settings: {
    connections: 50,
    durationSec: 10,
    warmupSec: 2,
    pipelining: 1,
    keepAlive: true,
    nodeEnv: 'production',
    host: '127.0.0.1',
  },
  skipped: [{ scenario: 'sqlite-read', reason: 'No v1 database API on master.' }],
  runs: [
    {
      app: 'hono',
      runtime: 'node',
      status: 'ok',
      coldStartMs: 42.5,
      rss: { idleBytes: 64 * 1024 ** 2, underLoadMaxBytes: 96 * 1024 ** 2 },
      scenarios: [
        { name: 'json', status: 'ok', requestsPerSec: 12345.6, latencyMs: { p50: 1.25, p99: 2.5 } },
        { name: 'path-param', status: 'ok', requestsPerSec: 10000, latencyMs: { p50: 1.1, p99: 2.2 } },
        { name: 'validation-ok', status: 'ok', requestsPerSec: 9000, latencyMs: { p50: 1.2, p99: 2.3 } },
        { name: 'validation-422', status: 'ok', requestsPerSec: 8000, latencyMs: { p50: 1.3, p99: 2.4 } },
        { name: 'middleware', status: 'ok', requestsPerSec: 7000, latencyMs: { p50: 1.4, p99: 2.6 } },
        { name: 'scoped', status: 'ok', requestsPerSec: 6000, latencyMs: { p50: 1.5, p99: 2.7 } },
      ],
    },
    {
      app: 'express',
      runtime: 'bun',
      status: 'failed',
      coldStartMs: null,
      rss: { idleBytes: null, underLoadMaxBytes: null },
      scenarios: [{ name: 'json', status: 'failed', error: 'server exited' }],
    },
  ],
})

describe('report values', () => {
  it('formats bytes and missing samples', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(0)).toBe('0.0 MB')
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB')
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB')
  })

  it('rounds with the requested precision and keeps missing values null', () => {
    expect(round(1.26)).toBe(1.3)
    expect(round(1.2345, 2)).toBe(1.23)
    expect(round(Number.NaN)).toBeNull()
    expect(round(Infinity)).toBeNull()
    expect(round(undefined)).toBeNull()
  })

  it('builds the schema version and the phase note, without mutating the inputs', () => {
    const skipped = [{ scenario: 'sqlite-read', reason: 'skip' }]
    const built = buildReport({ generatedAt, commit: report.commit, machine: report.machine, runtimes: report.runtimes, versions: report.versions, settings: report.settings, skipped, runs: [] })
    expect(built.schemaVersion).toBe(REPORT_SCHEMA_VERSION)
    expect(built.phase).toBe('1 (hand-written Laratype production entry, not sauf build)')
    expect(built.generatedAt).toBe(generatedAt)
    expect(built.skipped).toBe(skipped)
    expect(skipped).toHaveLength(1)
  })

  it('names the JSON and Markdown files from the short SHA and the UTC timestamp', () => {
    expect(reportBaseName(report.commit.sha, generatedAt)).toBe('0123456789ab-2026-11-25T12-34-56-789Z')
    expect(reportBaseName('', generatedAt)).toBe('unknown-2026-11-25T12-34-56-789Z')
  })
})

describe('markdown', () => {
  const text = markdown(report)

  it('carries the commit, machine and runtime header', () => {
    expect(text).toContain('# Laratype phase-1 runtime benchmark')
    expect(text).toContain('**Commit:** `0123456789abcdef0123456789abcdef01234567` on `build/b26-bench-phase1`')
    expect(text).not.toContain('dirty working tree')
    expect(text).toContain('**Runtimes:** Node v22.23.5, Bun 1.3.14')
    expect(text).toContain('Test CPU, 8 cores, 16.0 GiB, linux 6.8.0 (x64)')
    expect(text).toContain('Generated in `bench/Dockerfile`')
  })

  it('renders one table per metric with the scenario rows', () => {
    expect(text).toContain('### Requests per second (higher is better)')
    expect(text).toContain('### p50 latency, ms (lower is better)')
    expect(text).toContain('### p99 latency, ms (lower is better)')
    expect(text).toContain('| Scenario | Hono · node | Express · bun |')
    expect(text).toContain('| json | 12345.6 | — |')
    expect(text).toContain('| scoped | 6000 | — |')
  })

  it('renders cold start, RSS, skipped scenarios and failures', () => {
    expect(text).toContain('| Hono | node | 42.5 | 64.0 MB | 96.0 MB | ok |')
    expect(text).toContain('| Express | bun | — | — | — | failed |')
    expect(text).toContain('### Skipped')
    expect(text).toContain('- **sqlite-read**: No v1 database API on master.')
    expect(text).toContain('### Failures')
    expect(text).toContain('- Express · bun · json: server exited')
  })

  it('marks a dirty tree', () => {
    const dirty = markdown({ ...report, commit: { ...report.commit, dirty: true } })
    expect(dirty).toContain('(dirty working tree)')
  })
})
