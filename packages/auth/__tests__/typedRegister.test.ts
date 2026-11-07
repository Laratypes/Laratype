// A1 #119: the `types` project is one program, so it cannot hold both a registered and an unregistered app. This
// compiles the unregistered fixture with tsc, like packages/contract/__tests__/typecheck.test.ts.
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/typed-register/unregistered.ts', import.meta.url))
// The ambient declarations tsconfig.app.json's `include` gives the package sources (packages/global.d.ts) and the
// hono `HonoRequest.input` augmentation the auth package's http imports need.
const ambient = [`${root}packages/global.d.ts`, `${root}packages/http/src/overload.d.ts`]

const baseOptions = (): ts.CompilerOptions => {
  const { config } = ts.readConfigFile(`${root}tsconfig.app.json`, ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root)
  return { ...options, noEmit: true, composite: false, declaration: false, incremental: false }
}

describe('typed Register (A1 #119)', () => {
  it('keeps the 0.5 types before an app registers user and guards', () => {
    const program = ts.createProgram([fixture, ...ambient], baseOptions())
    const errors = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
      ts.formatDiagnostic(diagnostic, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    )
    expect(errors).toEqual([])
  }, 60_000)
})
