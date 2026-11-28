import { describe, expect, it } from 'vitest'
import { APPS, DEFAULTS, parseArgs, UsageError } from '../lib/args.mjs'

const defaultOut = '/repo/bench/out'
const parse = (argv = [], env = {}) => parseArgs(argv, { env, defaultOut })

describe('parseArgs', () => {
  it('defaults to every app and runtime on 127.0.0.1 settings', () => {
    const opts = parse()
    expect(opts).toMatchObject({
      apps: APPS,
      runtimes: DEFAULTS.runtimes,
      scenario: null,
      connections: 50,
      duration: 10,
      warmup: 2,
      smoke: false,
      out: defaultOut,
      node: 'node',
      bun: 'bun',
      allowNodeMismatch: false,
      help: false,
    })
  })

  it('reads the BENCH_* environment used by the CI dispatch inputs', () => {
    const opts = parse([], {
      BENCH_APPS: 'hono, express',
      BENCH_RUNTIMES: 'bun',
      BENCH_SCENARIO: 'json',
      BENCH_CONNECTIONS: '25',
      BENCH_DURATION: '5',
      BENCH_WARMUP: '1',
      BENCH_OUT: '/out',
      BENCH_NODE: '/usr/local/bin/node',
      BENCH_BUN: '/usr/local/bin/bun',
      BENCH_ALLOW_NODE_MISMATCH: '1',
    })
    expect(opts).toMatchObject({
      apps: ['hono', 'express'],
      runtimes: ['bun'],
      scenario: 'json',
      connections: 25,
      duration: 5,
      warmup: 1,
      out: '/out',
      node: '/usr/local/bin/node',
      bun: '/usr/local/bin/bun',
      allowNodeMismatch: true,
    })
  })

  it('treats an empty environment value as unset', () => {
    // A pull_request run of the bench workflow has no dispatch inputs, so every BENCH_* value is empty.
    const opts = parse([], { BENCH_APPS: '', BENCH_RUNTIMES: ' ', BENCH_DURATION: '', BENCH_OUT: '' })
    expect(opts.apps).toEqual(APPS)
    expect(opts.runtimes).toEqual(DEFAULTS.runtimes)
    expect(opts.duration).toBe(10)
    expect(opts.out).toBe(defaultOut)
  })

  it('lets flags override the environment and the defaults', () => {
    const opts = parse(
      ['--apps', 'express', '--runtimes', 'node', '--scenario', 'validation-422', '--connections', '10', '--duration', '3', '--warmup', '0', '--out', '/tmp/bench', '--node', 'n', '--bun', 'b', '--allow-node-mismatch'],
      { BENCH_APPS: 'laratype', BENCH_RUNTIMES: 'bun', BENCH_DURATION: '30' },
    )
    expect(opts).toMatchObject({
      apps: ['express'],
      runtimes: ['node'],
      scenario: 'validation-422',
      connections: 10,
      duration: 3,
      warmup: 0,
      out: '/tmp/bench',
      node: 'n',
      bun: 'b',
      allowNodeMismatch: true,
    })
  })

  it('parses --smoke and forces the 1 s profile with no warm-up', () => {
    const opts = parse(['--smoke', '--duration', '20', '--warmup', '5'])
    expect(opts.smoke).toBe(true)
    expect(opts.duration).toBe(1)
    expect(opts.warmup).toBe(0)
  })

  it('recognises --help and -h', () => {
    expect(parse(['--help']).help).toBe(true)
    expect(parse(['-h']).help).toBe(true)
  })

  it('rejects unknown apps and runtimes', () => {
    expect(() => parse(['--apps', 'hono,nope'])).toThrow(UsageError)
    expect(() => parse(['--apps', 'hono,nope'])).toThrow(/unknown app nope/)
    expect(() => parse(['--runtimes', 'deno'])).toThrow(/unknown runtime deno/)
  })

  it('rejects a list without values', () => {
    expect(() => parse(['--apps', ''])).toThrow(/--apps needs at least one value/)
    expect(() => parse([], { BENCH_RUNTIMES: ' , ' })).toThrow(/BENCH_RUNTIMES needs at least one value/)
  })

  it('rejects missing, non-numeric and negative values', () => {
    expect(() => parse(['--duration'])).toThrow(/--duration needs a value/)
    expect(() => parse(['--duration', '--smoke'])).toThrow(/--duration needs a value/)
    expect(() => parse(['--connections', 'many'])).toThrow(/--connections needs a non-negative number/)
    expect(() => parse([], { BENCH_WARMUP: '-1' })).toThrow(/BENCH_WARMUP needs a non-negative number/)
  })

  it('rejects an unknown flag', () => {
    expect(() => parse(['--verbose'])).toThrow(/unknown argument --verbose/)
  })

  it('needs a default output directory', () => {
    expect(() => parseArgs([], { env: {} })).toThrow(TypeError)
  })
})
