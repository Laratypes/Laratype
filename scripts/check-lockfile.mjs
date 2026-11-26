// @ts-check
// Checks the supply-chain inputs of bun.lock and the workspace manifests (B14 #189):
//  1. parse bun.lock as JSONC and require every packages entry to be a plain semver
//     (or workspace:) ref, an empty registry slot, and a sha512- integrity;
//  2. keep a text scan for non-registry sources as a second layer;
//  3. scan the manifests derived from workspaces.packages (dir and dir/*), plus
//     resolutions, workspaces.catalog and workspaces.catalogs.*;
//  4. no manifest adds trustedDependencies (the allowlist is empty);
//  5. bun pm untrusted must be fully understood and list no script outside the allowlist.
// Usage: bun run check:lockfile
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(import.meta.url), '../..')
const ALLOWED_TRUSTED_DEPENDENCIES = /** @type {string[]} */ ([])
const ALLOWED_INSTALL_SCRIPTS = ['@swc/core']

const NON_REGISTRY_SOURCE = /(?:https?:\/\/|git\+|git@|git:|gitlab:|bitbucket:|ssh:|svn:|github:|file:|link:|tarball)/i
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/
const GLOB_META = /[*?[\]{}!]/
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'resolutions']

/** @param {unknown} value */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Remove trailing commas outside strings, so Bun's JSONC lockfile can be parsed.
 * @param {string} text
 */
const stripTrailingCommas = (text) => {
  let result = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      result += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      result += char
      continue
    }
    if (char === ',') {
      let next = index + 1
      while (next < text.length && /\s/.test(text[next])) next++
      if (text[next] === ']' || text[next] === '}') continue
    }
    result += char
  }
  return result
}

/**
 * @param {string} context
 * @param {unknown} map
 * @param {string[]} errors
 */
const checkDependencyMap = (context, map, errors) => {
  if (!isObject(map)) return
  for (const [name, spec] of Object.entries(map)) {
    if (typeof spec === 'string') {
      if (NON_REGISTRY_SOURCE.test(spec)) errors.push(`${context}.${name}: non-registry source "${spec}"`)
    }
    else if (isObject(spec)) {
      checkDependencyMap(`${context}.${name}`, spec, errors)
    }
  }
}

/**
 * @param {string} context
 * @param {Record<string, any>} pkg
 * @param {string[]} errors
 */
const checkTrusted = (context, pkg, errors) => {
  const trusted = pkg.trustedDependencies
  if (trusted === undefined) return
  if (!Array.isArray(trusted) || trusted.some(name => typeof name !== 'string')) {
    errors.push(`${context}: trustedDependencies must be an array of package names`)
    return
  }
  if (trusted.some(name => !ALLOWED_TRUSTED_DEPENDENCIES.includes(name))) {
    errors.push(`${context}: trustedDependencies is not allowed without review: ${JSON.stringify(trusted)}`)
  }
}

/**
 * Manifests declared by workspaces.packages. Only "dir" and "dir/*" are supported.
 * @param {string} targetRoot
 * @param {Record<string, any>} rootPkg
 * @param {string[]} errors
 * @returns {string[]}
 */
const workspaceManifests = (targetRoot, rootPkg, errors) => {
  const manifests = new Set([path.join(targetRoot, 'package.json')])
  const workspaces = rootPkg.workspaces
  if (workspaces !== undefined && !Array.isArray(workspaces) && !isObject(workspaces)) {
    errors.push('package.json: workspaces must be an array or an object')
  }
  if (isObject(workspaces) && workspaces.packages !== undefined && !Array.isArray(workspaces.packages)) {
    errors.push('package.json: workspaces.packages must be an array')
  }
  const globs = Array.isArray(workspaces)
    ? workspaces
    : isObject(workspaces) && Array.isArray(workspaces.packages) ? workspaces.packages : []
  for (const raw of globs) {
    if (typeof raw !== 'string') {
      errors.push(`package.json: workspaces.packages entry is not a string: ${JSON.stringify(raw)}`)
      continue
    }
    const glob = raw.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!glob) {
      errors.push('package.json: workspaces.packages has an empty entry')
      continue
    }
    const hasMeta = GLOB_META.test(glob)
    if (hasMeta && !glob.endsWith('/*')) {
      errors.push(`package.json: workspaces.packages glob "${raw}" is unsupported (only "dir" and "dir/*")`)
      continue
    }
    if (glob.endsWith('/*')) {
      const basePart = glob.slice(0, -2)
      if (!basePart || GLOB_META.test(basePart)) {
        errors.push(`package.json: workspaces.packages glob "${raw}" is unsupported (only "dir" and "dir/*")`)
        continue
      }
      const base = path.join(targetRoot, ...basePart.split('/'))
      if (!existsSync(base)) {
        errors.push(`package.json: workspaces.packages "${raw}" has no directory`)
        continue
      }
      let found = 0
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const manifest = path.join(base, entry.name, 'package.json')
        if (existsSync(manifest)) {
          manifests.add(manifest)
          found += 1
        }
      }
      if (found === 0) errors.push(`package.json: workspaces.packages "${raw}" matched no package.json`)
    }
    else {
      if (hasMeta) {
        errors.push(`package.json: workspaces.packages glob "${raw}" is unsupported (only "dir" and "dir/*")`)
        continue
      }
      const manifest = path.join(targetRoot, ...glob.split('/'), 'package.json')
      if (!existsSync(manifest)) {
        errors.push(`package.json: workspaces.packages "${raw}" has no package.json`)
        continue
      }
      manifests.add(manifest)
    }
  }
  return [...manifests].sort()
}

/**
 * @param {string} targetRoot
 * @param {string[]} errors
 */
const checkManifests = (targetRoot, errors) => {
  const rootPath = path.join(targetRoot, 'package.json')
  let rootPkg
  try {
    rootPkg = JSON.parse(readFileSync(rootPath, 'utf-8'))
  }
  catch (error) {
    errors.push(`package.json: cannot read or parse: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  for (const manifest of workspaceManifests(targetRoot, rootPkg, errors)) {
    let pkg
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf-8'))
    }
    catch (error) {
      errors.push(`${path.relative(targetRoot, manifest).replace(/\\/g, '/') || 'package.json'}: cannot parse: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const rel = path.relative(targetRoot, manifest).replace(/\\/g, '/') || 'package.json'
    for (const field of DEPENDENCY_FIELDS) checkDependencyMap(`${rel}: ${field}`, pkg[field], errors)
    checkTrusted(rel, pkg, errors)
    if (isObject(pkg.workspaces)) {
      if (isObject(pkg.workspaces.catalog)) checkDependencyMap(`${rel}: workspaces.catalog`, pkg.workspaces.catalog, errors)
      if (isObject(pkg.workspaces.catalogs)) {
        for (const [name, catalog] of Object.entries(pkg.workspaces.catalogs)) {
          checkDependencyMap(`${rel}: workspaces.catalogs.${name}`, catalog, errors)
        }
      }
    }
  }
}

/**
 * @param {Record<string, any>} lock
 * @param {string[]} errors
 * @returns {{ entries: number, integrity: number, workspace: number }}
 */
const checkLockEntries = (lock, errors) => {
  if (!isObject(lock.packages)) {
    errors.push('bun.lock: "packages" is missing or not an object')
    return { entries: 0, integrity: 0, workspace: 0 }
  }
  let entries = 0
  let integrity = 0
  let workspace = 0
  for (const [name, value] of Object.entries(lock.packages)) {
    entries += 1
    if (!Array.isArray(value)) {
      errors.push(`bun.lock: packages.${name} is not an array`)
      continue
    }
    const first = value[0]
    if (typeof first !== 'string') {
      errors.push(`bun.lock: packages.${name}[0] is not a name@ref string`)
      continue
    }
    const at = first.lastIndexOf('@')
    if (at <= 0) {
      errors.push(`bun.lock: packages.${name}[0] has no name@ref: ${JSON.stringify(first)}`)
      continue
    }
    const ref = first.slice(at + 1)
    if (ref.startsWith('workspace:')) {
      workspace += 1
      continue
    }
    if (!SEMVER.test(ref)) {
      errors.push(`bun.lock: packages.${name}: unsupported ref "${ref}" (only semver or workspace:)`)
      continue
    }
    if (value[1] !== '') {
      errors.push(`bun.lock: packages.${name}: registry slot must be empty, got ${JSON.stringify(value[1])}`)
      continue
    }
    const last = value[value.length - 1]
    if (typeof last !== 'string' || !last.startsWith('sha512-')) {
      errors.push(`bun.lock: packages.${name}: last element is not a sha512- integrity`)
      continue
    }
    integrity += 1
  }
  return { entries, integrity, workspace }
}

/**
 * @param {string} output
 * @returns {{ names: Set<string>, unknown: string[] }}
 */
const parseUntrusted = (output) => {
  const names = new Set()
  /** @type {string[]} */
  const unknown = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, '').trim()
    if (!line) continue
    if (/^bun pm untrusted v\d+\.\d+\.\d+/.test(line)) continue
    if (line.startsWith('» [')) continue
    if (line.startsWith('These dependencies had their lifecycle scripts blocked during install.')) continue
    if (line.startsWith('If you trust them and wish to run their scripts, use ')) continue
    if (/^Found \d+ untrusted dependencies with scripts\.$/.test(line)) continue
    if (line === 'This means all packages with scripts are in "trustedDependencies" or none of your dependencies have scripts.') continue
    if (line === 'For more information, visit https://bun.com/docs/install/lifecycle#trusteddependencies') continue
    if (line === 'No untrusted dependencies with scripts found.') continue
    let normalized = line.replace(/\\/g, '/')
    if (normalized.startsWith('./')) normalized = normalized.slice(2)
    const index = normalized.lastIndexOf('node_modules/')
    const candidate = index >= 0 ? normalized.slice(index + 'node_modules/'.length) : normalized
    const match = candidate.match(/^(.+?)\s+@\S+$/)
    if (match) {
      names.add(match[1].trim())
      continue
    }
    unknown.push(line)
  }
  return { names, unknown }
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
  let lockText
  try {
    lockText = readFileSync(lockPath, 'utf-8')
  }
  catch (error) {
    throw new Error(`cannot read ${path.relative(targetRoot, lockPath)}: ${error instanceof Error ? error.message : String(error)}`)
  }

  // A registry "resolved" URL is the one HTTPS form that is allowed; check those separately
  // below, then scan the rest of the lock for non-registry sources.
  const sourceText = lockText.replace(/"resolved"\s*:\s*"https:\/\/registry\.npmjs\.org\/[^"]*"/g, '"resolved":"<registry>"')
  for (const [index, line] of sourceText.split(/\r?\n/).entries()) {
    const match = line.match(NON_REGISTRY_SOURCE)
    if (match) errors.push(`bun.lock:${index + 1}: non-registry source "${match[0]}"`)
  }
  for (const match of lockText.matchAll(/"resolved"\s*:\s*"([^"]*)"/g)) {
    if (!match[1].startsWith('https://registry.npmjs.org/')) {
      errors.push(`bun.lock: "resolved" points outside registry.npmjs.org: ${match[1]}`)
    }
  }

  let stats = { entries: 0, integrity: 0, workspace: 0 }
  let lock
  try {
    lock = JSON.parse(stripTrailingCommas(lockText))
  }
  catch (error) {
    errors.push(`bun.lock: cannot parse as JSONC: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (lock !== undefined) {
    if (!isObject(lock)) errors.push('bun.lock: top level is not an object')
    else stats = checkLockEntries(lock, errors)
  }

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
    const parsed = parseUntrusted(untrustedOutput)
    for (const line of parsed.unknown) errors.push(`bun pm untrusted: unrecognized output line: ${line}`)
    for (const name of parsed.names) {
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
    stats: { ...stats, installScripts, installScriptsSkipped },
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
