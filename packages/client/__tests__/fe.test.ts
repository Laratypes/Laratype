import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The FE fixtures compiled with their own tsconfig: no repo/app tsconfig, `types: []`, DOM lib.
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')

const run = (tsconfig: string, ...args: string[]) => {
  const child = spawnSync(process.execPath, [tsc, '-p', `${fixtures}${tsconfig}`, ...args], { encoding: 'utf-8' })
  return { status: child.status, output: `${child.stdout}${child.stderr}`.trim() }
}

/** Every file of the program, grouped; anything outside the FE-safe groups counts as a server file. */
const classify = (file: string) => {
  const f = file.replace(/\\/g, '/')
  if (/\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(f)) return 'typescript lib'
  if (/\/node_modules\/(\.bun\/[^/]+\/node_modules\/)?(zod|valibot)\//.test(f)) return 'schema lib'
  if (f.startsWith(`${root}packages/contract/src/`)) return '@laratype/contract'
  if (f.startsWith(`${root}packages/client/src/`)) return '@laratype/client'
  if (f.startsWith(`${root}packages/client/__tests__/fixtures/`)) return 'fixture'
  return `server: ${f.startsWith(root) ? f.slice(root.length) : f}`
}

const listFiles = (tsconfig: string, ...args: string[]) => {
  const { status, output } = run(tsconfig, '--listFilesOnly', ...args)
  expect(status).toBe(0)
  const files = output.split(/\r?\n/).filter(Boolean)
  const groups: Record<string, number> = {}
  for (const file of files) groups[classify(file)] = (groups[classify(file)] ?? 0) + 1
  return { files, groups, server: Object.keys(groups).filter((g) => g.startsWith('server:')) }
}

describe('FE fixture (createClient with the generated appApi)', () => {
  it('type-checks with `types: []` + DOM', () => {
    expect(run('tsconfig.json')).toEqual({ status: 0, output: '' })
  }, 60_000)

  it('`tsc --listFilesOnly` loads 0 server files and 0 hono files', () => {
    const { files, groups, server } = listFiles('tsconfig.json')
    expect(server).toEqual([])
    expect(files.filter((f) => /hono/i.test(f))).toEqual([])
    // fe/main.ts, index.gen.ts, 3 $types.d.ts, 2 _scope.ts, _errors.ts, users.ts, posts.ts, health/index.ts
    expect(groups.fixture).toBe(11)
    expect(groups['@laratype/client']).toBeGreaterThan(0)
    expect(groups['@laratype/contract']).toBeGreaterThan(0)
  }, 60_000)

  it('negative control: the app tsconfig setting `jsxImportSource: "hono/jsx"` would load hono files', () => {
    const { server } = listFiles('tsconfig.json', '--jsxImportSource', 'hono/jsx')
    expect(server.filter((f) => /hono/.test(f)).length).toBeGreaterThan(0)
  }, 60_000)
})

describe('separate-repo FE fixture (createClient<AppApi>(manifest) with the generated api.ts)', () => {
  it('type-checks with `types: []` + DOM', () => {
    expect(run('separate-fe/tsconfig.json')).toEqual({ status: 0, output: '' })
  }, 60_000)

  it('`tsc --listFilesOnly` loads 0 server, hono or schema-lib files, and no contract file of the app', () => {
    const { files, groups, server } = listFiles('separate-fe/tsconfig.json')
    expect(server).toEqual([])
    expect(files.filter((f) => /hono/i.test(f))).toEqual([])
    expect(groups['schema lib']).toBeUndefined()
    // main.ts and api.ts (which imports nothing)
    expect(groups.fixture).toBe(2)
    // @laratype/contract comes from @laratype/client's own dependency (buildUrl and its types). It is browser-pure.
    expect(Object.keys(groups).sort()).toEqual(['@laratype/client', '@laratype/contract', 'fixture', 'typescript lib'])
  }, 60_000)
})
