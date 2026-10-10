// Type-checks the spec examples (docs/v1/examples/<area>/*.ts) with tsc, so a stale example fails `bun run test`.
// `proposed/` examples target APIs that are still in an open PR: they are checked against that PR's head
// before committing and move up one level when the PR merges (see docs/v1/README.md).
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const examples = fileURLToPath(new URL('./', import.meta.url))

// Same options as packages/contract/__tests__/typecheck.test.ts (copied, not imported from a test file)
const baseOptions = (): ts.CompilerOptions => {
  const { config } = ts.readConfigFile(`${root}tsconfig.app.json`, ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root)
  return { ...options, noEmit: true, composite: false, declaration: false, incremental: false }
}

const diagnostics = (rootNames: string[], options: ts.CompilerOptions) =>
  ts
    .getPreEmitDiagnostics(ts.createProgram(rootNames, options))
    .map((d) => ts.formatDiagnostic(d, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }))

const exampleFiles = (): string[] =>
  readdirSync(examples)
    .filter((area) => statSync(`${examples}${area}`).isDirectory())
    .flatMap((area) =>
      readdirSync(`${examples}${area}`)
        .filter((f) => f.endsWith('.ts') && statSync(`${examples}${area}/${f}`).isFile())
        .map((f) => `${examples}${area}/${f}`),
    )

// Ambient declarations that tsconfig.json pulls in through its `include`: examples that import a 0.5 package
// (e.g. @laratype/support) need its globals and the hono `HonoRequest.input` augmentation.
const ambient = [`${root}packages/global.d.ts`, `${root}packages/http/src/overload.d.ts`]

describe('docs/v1 examples', () => {
  it('compile against packages/*/src (proposed/ excluded)', () => {
    const files = exampleFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(diagnostics([...files, ...ambient], baseOptions())).toEqual([])
  }, 60_000)
})
