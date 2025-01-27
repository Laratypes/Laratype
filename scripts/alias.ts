// @ts-check
// these aliases are shared between vitest and rollup
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const resolveEntryForPkg = (p: string) =>
  path.resolve(
    fileURLToPath(import.meta.url),
    `../../packages/${p}/src/index.ts`,
  )

const dirs = readdirSync(new URL('../packages', import.meta.url))

const entries: Record<string, string> = {
}


for (const dir of dirs) {
  const key = `@laratype/${dir}`
  if (
    !(key in entries) &&
    statSync(new URL(`../packages/${dir}`, import.meta.url)).isDirectory()
  ) {
    entries[key] = resolveEntryForPkg(dir)
  }
}

export { entries }