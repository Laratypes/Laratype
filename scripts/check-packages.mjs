// @ts-check
// Lints every public package (not "private": true) with publint and @arethetypeswrong/cli.
// publint runs with --strict, so its warnings fail too; its suggestions do not.
// Usage: bun run build && bun run build:type && bun run check:pkg
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(import.meta.url), '../..')

/**
 * attw arguments per package, each with the reason.
 * @type {Record<string, string[]>}
 */
const ATTW_ARGS = {
  // `@laratype/support/env` is a global script (no import/export) loaded with
  // `/// <reference types="@laratype/support/env" />`, so ESM vs CJS does not apply to it.
  '@laratype/support': ['--exclude-entrypoints', './env'],
}

const packages = readdirSync(path.join(root, 'packages'))
  .filter(dir => existsSync(path.join(root, 'packages', dir, 'package.json')))
  .map(dir => ({ dir, pkg: JSON.parse(readFileSync(path.join(root, 'packages', dir, 'package.json'), 'utf-8')) }))
  .filter(({ pkg }) => !pkg.private)

/** @type {string[]} */
const failures = []
/** @param {string} label @param {string[]} args */
const run = (label, args) => {
  const child = spawnSync('bunx', args, { cwd: root, encoding: 'utf-8', shell: process.platform === 'win32' })
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`.trim()
  if (child.status === 0) {
    console.log(`  ok   ${label}`)
  }
  else {
    failures.push(label)
    console.log(`  FAIL ${label}\n${output.replace(/^/gm, '       ')}`)
  }
}

for (const { dir, pkg } of packages) {
  const pkgDir = `packages/${dir}`
  if (!existsSync(path.join(root, pkgDir, 'dist'))) {
    failures.push(`${pkg.name}: no dist`)
    console.log(`  FAIL ${pkg.name}: no dist, run \`bun run build && bun run build:type\``)
    continue
  }
  console.log(pkg.name)
  run(`publint ${pkgDir}`, ['publint', pkgDir, '--strict'])
  run(`attw ${pkgDir}`, ['attw', '--pack', pkgDir, '--format', 'ascii', ...(ATTW_ARGS[pkg.name] ?? [])])
}

if (failures.length) {
  console.log(`\ncheck:pkg failed: ${failures.length} problem(s)`)
  process.exit(1)
}
console.log(`\ncheck:pkg passed (${packages.length} packages)`)
