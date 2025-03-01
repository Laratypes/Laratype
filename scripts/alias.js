// @ts-check
// these aliases are shared between vitest and rollup
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 
 * @param {string} p 
 * @returns 
 */
const resolveEntryForPkg = (p) =>
  path.resolve(
    fileURLToPath(import.meta.url),
    `../../packages/${p}/src/index.ts`,
  )

const dirs = readdirSync(new URL('../packages', import.meta.url))

/**
 * @type {Record<string, string>}
 */
const entries = {
  sauf: resolveEntryForPkg('sauf')
}

for (const dir of dirs) {
  if(Object.hasOwnProperty.call(entries, dir)) {
    continue;
  }
  const key = `@laratype/${dir}`
  if (
    !(key in entries) &&
    statSync(new URL(`../packages/${dir}`, import.meta.url)).isDirectory()
  ) {
    entries[key] = resolveEntryForPkg(dir)
  }
}

export { entries }