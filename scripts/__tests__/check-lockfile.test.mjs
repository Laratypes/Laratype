// @ts-check
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkLockfile } from '../check-lockfile.mjs'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/check-lockfile')
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
/** @type {string[]} */
const roots = []

const CLEAN_UNTRUSTED = [
  'bun pm untrusted v1.3.14 (0d9b296a)',
  '',
  '.\\node_modules\\@swc\\core @1.13.5',
  ' » [postinstall]: node postinstall.js',
  '',
  'These dependencies had their lifecycle scripts blocked during install.',
  '',
  'If you trust them and wish to run their scripts, use `bun pm trust`.',
  '',
].join('\n')

const EMPTY_UNTRUSTED = [
  'bun pm untrusted v1.3.14 (0d9b296a)',
  'Found 0 untrusted dependencies with scripts.',
  '',
  'This means all packages with scripts are in "trustedDependencies" or none of your dependencies have scripts.',
  '',
  'For more information, visit https://bun.com/docs/install/lifecycle#trusteddependencies',
  '',
].join('\n')

const UNKNOWN_UNTRUSTED = [
  'bun pm untrusted v1.3.14 (0d9b296a)',
  'WARNING: the output format changed',
].join('\n')

/**
 * @param {string} name
 * @param {{ untrustedOutput?: string }} [options]
 */
const fixture = (name, options = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), 'laratype-check-lockfile-'))
  roots.push(root)
  for (const entry of readdirSync(path.join(FIXTURES, name))) {
    cpSync(path.join(FIXTURES, name, entry), path.join(root, entry), { recursive: true })
  }
  if (!existsSync(path.join(root, 'package.json'))) {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }, null, 2))
  }
  return { root, ...options }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('check:lockfile', () => {
  it('passes a clean lock with the known @swc/core install script', () => {
    const result = checkLockfile(fixture('clean', { untrustedOutput: CLEAN_UNTRUSTED }))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.stats).toMatchObject({ entries: 2, integrity: 1, workspace: 1, installScripts: 1 })
  })

  it('passes the empty bun pm untrusted output', () => {
    const result = checkLockfile(fixture('clean', { untrustedOutput: EMPTY_UNTRUSTED }))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.stats).toMatchObject({ installScripts: 0 })
  })

  it('fails an untrusted output line it cannot parse', () => {
    const result = checkLockfile(fixture('clean', { untrustedOutput: UNKNOWN_UNTRUSTED }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unrecognized output line')
    expect(result.errors.join('\n')).toContain('WARNING')
  })

  it.each([
    ['https'],
    ['git-plus'],
    ['github'],
    ['file'],
  ])('fails a non-registry source (%s)', (name) => {
    const result = checkLockfile(fixture(name, { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('non-registry source')
  })

  it.each([
    ['evil-git'],
    ['evil-gitlab'],
    ['evil-bitbucket'],
    ['evil-ssh'],
  ])('fails a non-semver packages ref (%s)', (name) => {
    const result = checkLockfile(fixture(name, { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unsupported ref')
  })

  it('fails a split multi-line entry with no sha512', () => {
    const result = checkLockfile(fixture('split-no-sha', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('last element is not a sha512- integrity')
  })

  it('fails a tab-indented entry with no sha512', () => {
    const result = checkLockfile(fixture('tab-no-sha', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('last element is not a sha512- integrity')
  })

  it('fails a non-empty registry slot', () => {
    const result = checkLockfile(fixture('registry-slot', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('registry slot must be empty')
  })

  it('passes an npm: alias', () => {
    const result = checkLockfile(fixture('npm-alias', { untrustedOutput: '' }))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.stats).toMatchObject({ entries: 1, integrity: 1 })
  })

  it('passes a scoped name', () => {
    const result = checkLockfile(fixture('scoped', { untrustedOutput: '' }))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('fails a lock that does not parse', () => {
    const result = checkLockfile(fixture('bad-json', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('cannot parse as JSONC')
  })

  it('scans a bench-style workspace from workspaces.packages', () => {
    const result = checkLockfile(fixture('bench-glob', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('bench/tool/package.json')
    expect(result.errors.join('\n')).toContain('non-registry source')
  })

  it('scans a plain workspace dir and resolutions', () => {
    const result = checkLockfile(fixture('plain-dir', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('pkg/package.json')
    expect(result.errors.join('\n')).toContain('resolutions.evil')
  })

  it('passes a workspace ref to a declared directory and the root entry', () => {
    const result = checkLockfile(fixture('workspace-declared', { untrustedOutput: '' }))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.stats).toMatchObject({ entries: 2, workspace: 2 })
  })

  it('fails a workspace ref that traverses up', () => {
    const result = checkLockfile(fixture('workspace-traversal', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('"../x"')
    expect(result.errors.join('\n')).toContain('must not contain empty, "." or ".." segments')
  })

  it('fails a workspace ref that traverses up inside a declared directory', () => {
    const result = checkLockfile(fixture('workspace-nested-traversal', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('"packages/../../x"')
    expect(result.errors.join('\n')).toContain('must not contain empty, "." or ".." segments')
  })

  it('fails an absolute workspace ref (posix and windows)', () => {
    const result = checkLockfile(fixture('workspace-absolute', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.filter(error => error.includes('must be relative to the repository root'))).toHaveLength(2)
  })

  it('fails a workspace ref with a backslash', () => {
    const result = checkLockfile(fixture('workspace-backslash', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('must use forward slashes')
  })

  it('fails a workspace ref to an undeclared directory', () => {
    const result = checkLockfile(fixture('workspace-undeclared', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('"packages/ghost"')
    expect(result.errors.join('\n')).toContain('not a declared workspace directory')
  })

  it.each([
    ['duplicate-package-key', 'duplicate key "left-pad" in object at $.packages'],
    ['duplicate-workspace-key', 'duplicate key "workspaces" in object at $'],
    ['duplicate-entry-key', 'duplicate key "dependencies"'],
  ])('fails a duplicate object key (%s)', (name, message) => {
    const result = checkLockfile(fixture(name, { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain(message)
  })

  it('passes the repository lockfile', () => {
    const result = checkLockfile({ root: REPO_ROOT, untrustedOutput: '' })
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('scans workspaces.catalogs.*', () => {
    const result = checkLockfile(fixture('catalogs', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('workspaces.catalogs.nightly.evil')
    expect(result.errors.join('\n')).toContain('non-registry source')
  })

  it('fails an unsupported workspace glob', () => {
    const result = checkLockfile(fixture('bad-glob', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unsupported')
    expect(result.errors.join('\n')).toContain('packages/**')
  })

  it('fails a package entry without a sha512 integrity', () => {
    const result = checkLockfile(fixture('no-integrity', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('last element is not a sha512- integrity')
  })

  it('fails a manifest with trustedDependencies', () => {
    const result = checkLockfile(fixture('trusted', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('trustedDependencies')
    expect(result.errors.join('\n')).toContain('not allowed without review')
  })

  it('fails an install script outside the allowlist', () => {
    const result = checkLockfile(fixture('clean', {
      untrustedOutput: './node_modules/@evil/pkg @1.0.0\n » [postinstall]: node install.js\n',
    }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('@evil/pkg')
  })

  it('throws when bun.lock is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'laratype-check-lockfile-'))
    roots.push(root)
    expect(() => checkLockfile({ root, untrustedOutput: '' })).toThrow(/cannot read bun\.lock/)
  })
})
