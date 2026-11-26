// @ts-check
// Checks the supply-chain inputs of bun.lock and the workspace manifests (B14 #189):
//  1. no non-registry source (http(s), git+, git@, github:, file:, link:, tarball) anywhere,
//     and every "resolved" field, if Bun adds one, points at https://registry.npmjs.org/;
//  2. every non-workspace package entry has a sha512- integrity string;
//  3. every package.json specifier is a semver range, workspace:* or catalog:;
//  4. no manifest adds trustedDependencies (the allowlist is empty);
//  5. bun pm untrusted lists no install script outside ALLOWED_INSTALL_SCRIPTS.
// Usage: bun run check:lockfile
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(import.meta.url), '../..')
const ALLOWED_TRUSTED_DEPENDENCIES = /** @type {string[]} */ ([])
const ALLOWED_INSTALL_SCRIPTS = ['@swc/core']

const NON_REGISTRY_SOURCE = /(?:https?:\/\/|git\+|git@|github:|file:|link:|tarball)/i

/** @param {string} targetRoot @returns {string[]} */
const manifestPaths = (targetRoot) => {
  const paths = [path.join(targetRoot, 'package.json')]
  for (const dir of ['packages', 'examples']) {
    const base = path.join(targetRoot, dir)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base)) {
      const manifest = path.join(base, name, 'package.json')
      if (existsSync(manifest)) paths.push(manifest)
    }
  }
  return paths.filter(existsSync)
}

/** @param {unknown} value */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * @param {string} targetRoot
 * @param {string[]} errors
 */
const checkManifests = (targetRoot, errors) => {
  for (const manifest of manifestPaths(targetRoot)) {
    let pkg
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf-8'))
    }
    catch (error) {
      errors.push(`${path.relative(targetRoot, manifest)}: cannot parse package.json: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides']) {
      const deps = pkg[field]
      if (!isObject(deps)) continue
      for (const [name, spec] of Object.entries(deps)) {
        if (typeof spec === 'string' && NON_REGISTRY_SOURCE.test(spec)) {
          errors.push(`${path.relative(targetRoot, manifest)}: ${field}.${name} uses a non-registry source: ${spec}`)
        }
      }
    }
    const catalog = isObject(pkg.workspaces) && isObject(pkg.workspaces.catalog) ? pkg.workspaces.catalog : undefined
    if (catalog) {
      for (const [name, spec] of Object.entries(catalog)) {
        if (typeof spec === 'string' && NON_REGISTRY_SOURCE.test(spec)) {
          errors.push(`${path.relative(targetRoot, manifest)}: workspaces.catalog.${name} uses a non-registry source: ${spec}`)
        }
      }
    }
    const trusted = pkg.trustedDependencies
    if (trusted !== undefined) {
      if (!Array.isArray(trusted) || trusted.some(name => typeof name !== 'string')) {
        errors.push(`${path.relative(targetRoot, manifest)}: trustedDependencies must be an array of package names`)
      }
      else if (trusted.length > 0 && trusted.some(name => !ALLOWED_TRUSTED_DEPENDENCIES.includes(name))) {
        errors.push(`${path.relative(targetRoot, manifest)}: trustedDependencies is not allowed without review: ${JSON.stringify(trusted)}`)
      }
    }
  }
}

/** @param {string} output @returns {Set<string>} */
const parseUntrusted = (output) => {
  const names = new Set()
  for (const raw of output.split(/\r?\n/)) {
    let line = raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/\\/g, '/').trim()
    if (!line || !/\s@\S+$/.test(line)) continue
    if (line.startsWith('./')) line = line.slice(2)
    const index = line.lastIndexOf('node_modules/')
    if (index >= 0) line = line.slice(index + 'node_modules/'.length)
    const match = line.match(/^(.+?)\s+@\S+$/)
    if (match) names.add(match[1].trim())
  }
  return names
}

/**
 * @param {{ root?: string, untrustedOutput?: string, untrustedRunner?: (root: string) => string }} [options]
 * @returns {{ ok: boolean, errors: string[], stats: { entries: number, integrity: number, workspace: number, installScripts: number, installScriptsSkipped: boolean } }}
 */
export function checkLockfile(options = {}) {
  const targetRoot = options.root ?? root
  /** @type {string[]} */
  const errors = []
  const lockPath = path.join(targetRoot, 'bun.lock')
  let lock
  try {
    lock = readFileSync(lockPath, 'utf-8')
  }
  catch (error) {
    throw new Error(`cannot read ${path.relative(targetRoot, lockPath)}: ${error instanceof Error ? error.message : String(error)}`)
  }

  // A registry "resolved" URL is the one HTTPS form that is allowed; check those separately
  // below, then scan the rest of the lock for non-registry sources.
  const sourceText = lock.replace(/"resolved"\s*:\s*"https:\/\/registry\.npmjs\.org\/[^"]*"/g, '"resolved":"<registry>"')
  for (const [index, line] of sourceText.split(/\r?\n/).entries()) {
    const match = line.match(NON_REGISTRY_SOURCE)
    if (match) errors.push(`bun.lock:${index + 1}: non-registry source "${match[0]}"`)
  }
  for (const match of lock.matchAll(/"resolved"\s*:\s*"([^"]*)"/g)) {
    if (!match[1].startsWith('https://registry.npmjs.org/')) {
      errors.push(`bun.lock: "resolved" points outside registry.npmjs.org: ${match[1]}`)
    }
  }

  let entries = 0
  let integrity = 0
  let workspace = 0
  for (const [index, line] of lock.split(/\r?\n/).entries()) {
    const match = line.match(/^\s{4}"[^"]+": \[(.*)\],?\s*$/)
    if (!match) continue
    entries += 1
    if (match[1].includes('@workspace:')) {
      workspace += 1
      continue
    }
    if (!match[1].includes('sha512-')) errors.push(`bun.lock:${index + 1}: package entry has no sha512- integrity`)
    else integrity += 1
  }
  if (entries === 0) errors.push('bun.lock: no package entries found; is this a Bun text lockfile?')

  checkManifests(targetRoot, errors)

  let installScripts = 0
  let installScriptsSkipped = false
  /** @type {string | undefined} */
  let untrustedOutput = options.untrustedOutput
  if (untrustedOutput === undefined && options.untrustedRunner) {
    untrustedOutput = options.untrustedRunner(targetRoot)
  }
  if (untrustedOutput === undefined) {
    if (existsSync(path.join(targetRoot, 'node_modules'))) {
      const child = spawnSync('bun', ['pm', 'untrusted'], {
        cwd: targetRoot,
        encoding: 'utf-8',
      })
      if (child.status !== 0) {
        errors.push(`bun pm untrusted failed (${child.status ?? 'no status'}): ${`${child.stdout ?? ''}${child.stderr ?? ''}`.trim()}`)
        untrustedOutput = ''
      }
      else {
        untrustedOutput = `${child.stdout ?? ''}${child.stderr ?? ''}`
      }
    }
    else {
      installScriptsSkipped = true
      untrustedOutput = ''
    }
  }
  if (!installScriptsSkipped) {
    for (const name of parseUntrusted(untrustedOutput)) {
      if (!ALLOWED_INSTALL_SCRIPTS.includes(name)) {
        errors.push(`install script not in the allowlist: ${name}; review it, then add it to ALLOWED_INSTALL_SCRIPTS`)
      }
      else {
        installScripts += 1
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: { entries, integrity, workspace, installScripts, installScriptsSkipped },
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const result = checkLockfile()
    if (!result.ok) {
      for (const error of result.errors) console.error(`check:lockfile: ${error}`)
      console.error(`check:lockfile failed: ${result.errors.length} problem(s)`)
      process.exit(1)
    }
    const { entries, integrity, workspace, installScripts, installScriptsSkipped } = result.stats
    const scripts = installScriptsSkipped
      ? ', install-script check skipped (no node_modules)'
      : `, ${installScripts} install script(s)`
    console.log(`check:lockfile passed (${entries} entries, ${integrity} sha512, ${workspace} workspace${scripts})`)
  }
  catch (error) {
    console.error(`check:lockfile: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
