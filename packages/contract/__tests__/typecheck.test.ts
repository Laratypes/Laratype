import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const pkg = fileURLToPath(new URL('../', import.meta.url))

const baseOptions = (): ts.CompilerOptions => {
  const { config } = ts.readConfigFile(`${root}tsconfig.app.json`, ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root)
  return { ...options, noEmit: true, composite: false, declaration: false, incremental: false }
}

const diagnostics = (rootNames: string[], options: ts.CompilerOptions) =>
  ts
    .getPreEmitDiagnostics(ts.createProgram(rootNames, options))
    .map((d) => ts.formatDiagnostic(d, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }))

describe('@laratype/contract types', () => {
  it('type tests compile (expectTypeOf + @ts-expect-error)', () => {
    const files = readdirSync(`${pkg}__tests__/types`).map((f) => `${pkg}__tests__/types/${f}`)
    expect(files.length).toBeGreaterThan(0)
    expect(diagnostics(files, baseOptions())).toEqual([])
  }, 60_000)

  it('src is browser-safe: compiles with the DOM lib and no Node types', () => {
    const options = { ...baseOptions(), lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [] }
    expect(diagnostics([`${pkg}src/index.ts`], options)).toEqual([])
  }, 60_000)
})

describe('FE fixture (defineApi is the only FE entry)', () => {
  // An FE tsconfig: DOM lib, no ambient types. `jsxImportSource` is dropped: the repo's tsconfig.app.json sets
  // "hono/jsx", which makes TS load hono's JSX runtime types into every program (a server dep the FE must not see).
  const feOptions = (): ts.CompilerOptions => ({ ...baseOptions(), lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [], jsxImportSource: undefined })
  const fixtures = `${pkg}__tests__/fixtures/`.replace(/\\/g, '/')
  const contractSrc = `${pkg}src/`.replace(/\\/g, '/')

  // Every file a program loads, grouped. Anything outside the FE-safe groups counts as a server file.
  const classify = (file: string) => {
    const f = file.replace(/\\/g, '/')
    if (/\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(f)) return 'typescript lib'
    if (/\/node_modules\/(\.bun\/[^/]+\/node_modules\/)?zod\//.test(f)) return 'schema lib (zod)'
    if (f.startsWith(contractSrc)) return '@laratype/contract'
    if (f.startsWith(`${fixtures}app/contracts/`)) return 'app contracts'
    if (f.startsWith(`${fixtures}fe/`)) return 'fe'
    return `server: ${f.startsWith(root.replace(/\\/g, '/')) ? f.slice(root.length) : f}`
  }
  const program = (entry: string) => ts.createProgram([`${fixtures}fe/${entry}`], feOptions())
  const groups = (p: ts.Program) => {
    const out: Record<string, number> = {}
    for (const sf of p.getSourceFiles()) {
      const g = classify(sf.fileName)
      out[g] = (out[g] ?? 0) + 1
    }
    return out
  }

  it('compiles with `types: []` + DOM and loads 0 server files', () => {
    const p = program('main.ts')
    expect(diagnostics([`${fixtures}fe/main.ts`], feOptions())).toEqual([])
    const g = groups(p)
    expect(Object.keys(g).filter((k) => k.startsWith('server:'))).toEqual([])
    expect(g['app contracts']).toBe(3)
    expect(g['@laratype/contract']).toBeGreaterThan(0)
    expect(g['schema lib (zod)']).toBeGreaterThan(0)
  }, 60_000)

  it('negative control: importing the routes file (`typeof routes`) is detected as server code', () => {
    const g = groups(program('bad.ts'))
    expect(Object.keys(g).filter((k) => k.startsWith('server:'))).toContain('server: packages/contract/__tests__/fixtures/server/routes.ts')
    expect(diagnostics([`${fixtures}fe/bad.ts`], feOptions()).join('\n')).toMatch(/node:http/)
  }, 60_000)
})
