/**
 * Reported dependency versions, read from the package the measured app loads them through.
 *
 * The bench imports hono, express and the like itself, so their copy under `bench/node_modules` is the measured one.
 * A peer dependency the app loads through a workspace package is different: `dayjs` comes from `@laratype/support`,
 * so resolving it from `bench/node_modules` would report the bench's pin instead of the app's runtime copy.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/**
 * The version of `name` that `anchor` resolves, where `anchor` is a file inside the package whose resolution the
 * report states (`packages/support/package.json` for dayjs). Pure: no server, no process.
 */
export function resolvedVersion(anchor, name) {
  const require = createRequire(anchor)
  let file
  try {
    file = require.resolve(`${name}/package.json`)
  } catch {
    throw new Error(`bench: ${name} is not installed for ${anchor}; run bun install --ignore-scripts`)
  }
  return JSON.parse(readFileSync(file, 'utf8')).version
}
