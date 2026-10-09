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
    expect(diagnostics([`${pkg}__tests__/types/endpoint.types.ts`], baseOptions())).toEqual([])
  }, 60_000)

  it('src is browser-safe: compiles with the DOM lib and no Node types', () => {
    const options = { ...baseOptions(), lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [] }
    expect(diagnostics([`${pkg}src/index.ts`], options)).toEqual([])
  }, 60_000)
})
