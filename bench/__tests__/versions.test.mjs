import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolvedVersion } from '../lib/versions.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const versionIn = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8')).version

describe('resolvedVersion', () => {
  it('reports the dayjs copy @laratype/support resolves, not the bench pin', () => {
    const reported = resolvedVersion(path.join(root, 'packages/support/package.json'), 'dayjs')
    expect(reported).toBe(versionIn('node_modules/dayjs/package.json'))
    if (existsSync(path.join(root, 'bench/node_modules/dayjs/package.json'))) {
      expect(reported).not.toBe(versionIn('bench/node_modules/dayjs/package.json'))
    }
  })

  it('names the package and the anchor when it cannot resolve', () => {
    expect(() => resolvedVersion(path.join(root, 'bench/package.json'), 'not-a-bench-package')).toThrow(
      /bench: not-a-bench-package is not installed for .*bench[\\/]package\.json/,
    )
  })
})
