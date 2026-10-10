// @ts-check
// Checks the package dists built by `bun run build` (bun.build.js):
//  1. no build inlines another workspace package (from the Bun metafiles in dist_tmp/bun-meta),
//  2. every package dist loads under plain Node via ESM import() and CJS require(),
//     with every export defined,
//  3. the sauf resources bundles (copied into apps by `sauf build`) pass `node --check`.
// Usage: bun run build && bun run check:dist
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(fileURLToPath(import.meta.url), '../..')
const META_DIR = path.join(root, 'dist_tmp/bun-meta')
const SAUF_RESOURCES = path.join(root, 'packages/sauf/resources/app')

/** @type {Record<string, string[]>} Exports that must be present and defined, on top of "every export is defined". */
const REQUIRED_EXPORTS = {
  '@laratype/http': ['Middleware', 'Route', 'Controller'],
}

/**
 * Third-party modules a package re-exports with `export *`. An export that is undefined in the
 * dist is accepted only when it is undefined in that module too (typeorm's optional mongodb names).
 * @type {Record<string, string[]>}
 */
const REEXPORTED_MODULES = {
  '@laratype/database': ['typeorm'],
}

// Child mode: `node scripts/check-dist.mjs --load <esm|cjs> <file> <package>`
if (process.argv[2] === '--load') {
  const [, , , mode, file, name] = process.argv
  // A bin dist (sauf) runs its CLI on load: make it print its version instead of parsing our args.
  process.argv = [process.argv[0], name, '--version']
  const mod = mode === 'esm'
    ? await import(pathToFileURL(file).href)
    : createRequire(import.meta.url)(file)
  /** @type {Record<string, unknown>[]} */
  const reexported = (REEXPORTED_MODULES[name] ?? []).map(id => createRequire(file)(id))
  const keys = Object.keys(mod)
  const undefinedKeys = keys.filter(key => mod[key] === undefined
    && !reexported.some(dep => key in dep && dep[key] === undefined))
  const missing = (REQUIRED_EXPORTS[name] ?? []).filter(key => !keys.includes(key))
  console.log(JSON.stringify({ keys: keys.length, undefinedKeys, missing }))
  process.exit(0)
}

/** @param {string} p */
const norm = (p) => p.replace(/\\/g, '/')
/** The `SomeError: message` line of a child's output (Node prints the offending source line first). */
/** @param {string} output */
const firstError = (output) => {
  const lines = output.trim().split('\n')
  return (lines.find(line => /^\s*(\w*Error\b|error:)/.test(line)) ?? lines.at(-1) ?? '').trim()
}
/** @type {string[]} */
const failures = []
/** @param {string} message */
const fail = (message) => {
  failures.push(message)
  console.log(`  FAIL ${message}`)
}

const workspace = readdirSync(path.join(root, 'packages'))
  .filter(dir => existsSync(path.join(root, 'packages', dir, 'package.json')))
  .map(dir => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'packages', dir, 'package.json'), 'utf-8'))
    return { dir, name: pkg.name, pkg }
  })
const workspaceDirs = new Set(workspace.map(w => w.dir))
const workspaceNames = workspace.map(w => w.name)

// 1. Inlining
console.log('Inlined workspace packages (Bun metafiles):')
if (!existsSync(META_DIR)) {
  fail(`${path.relative(root, META_DIR)} is missing, run \`bun run build\` first`)
}
else {
  for (const file of readdirSync(META_DIR).sort()) {
    const meta = JSON.parse(readFileSync(path.join(META_DIR, file), 'utf-8'))
    const own = norm(meta.entrypoint).match(/(?:^|\/)packages\/([^/]+)\//)?.[1]
    const inlined = new Set()
    for (const input of meta.inputs.map(norm)) {
      const dir = input.match(/(?:^|\/)packages\/([^/]+)\//)?.[1]
      if (dir && dir !== own && workspaceDirs.has(dir)) inlined.add(`packages/${dir}`)
      for (const name of workspaceNames) {
        if (input.includes(`node_modules/${name}/`)) inlined.add(name)
      }
    }
    if (inlined.size) fail(`${file}: inlines ${[...inlined].join(', ')}`)
    else console.log(`  ok   ${file} (${meta.inputs.length} inputs)`)
  }
  for (const { dir, name } of workspace) {
    if (!existsSync(path.join(root, 'packages', dir, 'src/index.ts'))) continue
    for (const format of ['esm', 'cjs']) {
      if (!existsSync(path.join(META_DIR, `packages_${dir}_src_index.${format}.json`))) {
        fail(`${name}: no ${format} metafile, run \`bun run build\``)
      }
    }
  }
}

// 2. Loading
console.log('Load under Node (import() / require()):')
for (const { dir, name, pkg } of workspace) {
  const entry = pkg.exports?.['.']
  if (!entry?.import && !entry?.require) continue
  for (const [mode, target] of [['esm', entry.import], ['cjs', entry.require]]) {
    if (!target) {
      fail(`${name}: exports["."] has no ${mode === 'esm' ? 'import' : 'require'} target`)
      continue
    }
    const file = path.join(root, 'packages', dir, target)
    const label = `${name} ${mode} ${path.relative(root, file)}`
    if (!existsSync(file)) {
      fail(`${label}: missing, run \`bun run build\``)
      continue
    }
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--load', mode, file, name], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 60_000,
    })
    const result = child.stdout.trim().split('\n').reverse()
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .find(Boolean)
    if (child.status !== 0 || !result) {
      fail(`${label}: ${firstError(child.stderr || child.stdout || child.error?.message || `exit ${child.status}`)}`)
    }
    else if (result.undefinedKeys.length || result.missing.length) {
      fail(`${label}: undefined exports [${result.undefinedKeys}] missing exports [${result.missing}]`)
    }
    else {
      console.log(`  ok   ${label} (${result.keys} exports)`)
    }
  }
}

// 3. sauf resources bundles: entry points with side effects (CLI, server), so syntax/link-check only.
console.log('node --check (sauf resources bundles):')
/** @type {(dir: string) => string[]} */
const walk = (dir) => readdirSync(dir).flatMap(entry => {
  const full = path.join(dir, entry)
  return statSync(full).isDirectory() ? walk(full) : [full]
})
if (!existsSync(SAUF_RESOURCES)) {
  fail(`${path.relative(root, SAUF_RESOURCES)} is missing, run \`bun run build\``)
}
else {
  for (const file of walk(SAUF_RESOURCES).filter(f => f.endsWith('.js'))) {
    const child = spawnSync(process.execPath, ['--check', file], { encoding: 'utf-8' })
    const label = path.relative(root, file)
    if (child.status !== 0) fail(`${label}: ${firstError(child.stderr)}`)
    else console.log(`  ok   ${label}`)
  }
}

if (failures.length) {
  console.log(`\ncheck:dist failed: ${failures.length} problem(s)`)
  process.exit(1)
}
console.log('\ncheck:dist passed')
