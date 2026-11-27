import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The FE fixtures compiled with their own tsconfig: no repo/app tsconfig, `types: []`, DOM lib.
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')

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

/**
 * A Hono package file: a `node_modules/hono/...` path, Bun's nested store included. The checkout path itself may
 * contain "hono" (the B33 worktree is `b33-hono`), so the package segment is what counts, not the substring.
 */
const isHonoPackageFile = (file: string): boolean =>
  /\/node_modules\/(\.bun\/[^/]+\/node_modules\/)?hono\//i.test(file.replace(/\\/g, '/'))

/** One `tsc -p <tsconfig> --listFiles` run: its diagnostics and every file of the program, grouped. */
const compile = (tsconfig: string, ...args: string[]) => {
  const child = spawnSync(process.execPath, [tsc, '-p', `${fixtures}${tsconfig}`, '--listFiles', ...args], { encoding: 'utf-8' })
  const lines = `${child.stdout}${child.stderr}`.split(/\r?\n/).filter(Boolean)
  // file lines are absolute paths; diagnostics are relative ("fe/main.ts(3,1): error TS...") or indented
  const files = lines.filter((l) => /^([A-Za-z]:)?[\\/]/.test(l))
  const diagnostics = lines.filter((l) => !files.includes(l))
  const groups: Record<string, number> = {}
  for (const file of files) groups[classify(file)] = (groups[classify(file)] ?? 0) + 1
  return { status: child.status, diagnostics, files, groups, server: Object.keys(groups).filter((g) => g.startsWith('server:')) }
}

describe('FE fixture (createClient with the generated appApi)', () => {
  it('type-checks with `types: []` + DOM and loads 0 server files and 0 hono files', () => {
    const { status, diagnostics, files, groups, server } = compile('tsconfig.json')
    expect(diagnostics).toEqual([])
    expect(status).toBe(0)
    expect(server).toEqual([])
    expect(files.filter(isHonoPackageFile)).toEqual([])
    // fe/main.ts, index.gen.ts, 3 $types.d.ts, 2 _scope.ts, _errors.ts, users.ts, posts.ts, health/index.ts
    expect(groups.fixture).toBe(11)
    expect(groups['@laratype/client']).toBeGreaterThan(0)
    expect(groups['@laratype/contract']).toBeGreaterThan(0)
  }, 60_000)

  it('negative control: the app tsconfig setting `jsxImportSource: "hono/jsx"` would load hono files', () => {
    const { files } = compile('tsconfig.json', '--jsxImportSource', 'hono/jsx')
    expect(files.filter(isHonoPackageFile).length).toBeGreaterThan(0)
  }, 60_000)
})

describe('separate-repo FE fixture (createClient<AppApi>(manifest) with the generated api.ts)', () => {
  it('type-checks with `types: []` + DOM and loads 0 server, hono or schema-lib files, and no contract file of the app', () => {
    const { status, diagnostics, files, groups, server } = compile('separate-fe/tsconfig.json')
    expect(diagnostics).toEqual([])
    expect(status).toBe(0)
    expect(server).toEqual([])
    expect(files.filter(isHonoPackageFile)).toEqual([])
    expect(groups['schema lib']).toBeUndefined()
    // main.ts and api.ts (which imports nothing)
    expect(groups.fixture).toBe(2)
    // @laratype/contract comes from @laratype/client's own dependency (buildUrl and its types). It is browser-pure.
    expect(Object.keys(groups).sort()).toEqual(['@laratype/client', '@laratype/contract', 'fixture', 'typescript lib'])
  }, 60_000)
})
