// @ts-check
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
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
  '.\\node_modules\\@swc\\core @1.16.22',
  ' » [postinstall]: node postinstall.js',
  '',
  'These dependencies had their lifecycle scripts blocked during install.',
  '',
  'If you trust them and wish to run their scripts, use `bun pm trust`.',
  '',
].join('\n')

const DEFAULT_TRUSTED_OUTPUT = [
  'Default trusted dependencies (2):',
  ' - esbuild',
  ' - sharp',
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
 * @param {{ untrustedOutput?: string, defaultTrustedOutput?: string }} [options]
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
  return { root, defaultTrustedOutput: DEFAULT_TRUSTED_OUTPUT, ...options }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * @param {string} root
 * @param {Record<string, unknown>} packages
 */
const writeLock = (root, packages) => {
  writeFileSync(path.join(root, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, configVersion: 0, packages }, null, 2))
}

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

  it('fails an npm: alias ref (not a plain registry version)', () => {
    const result = checkLockfile(fixture('npm-alias', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('ref must not contain "@"')
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

  it('fails the allowlisted install script at another version', () => {
    const result = checkLockfile(fixture('clean', {
      untrustedOutput: '.\\node_modules\\@swc\\core @1.13.5\n » [postinstall]: node postinstall.js\n',
    }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('@swc/core@1.13.5')
    expect(result.errors.join('\n')).toContain('ALLOWED_INSTALL_SCRIPTS')
  })

  it.each([
    ['a non-array entry', { 'left-pad': 42 }, 'is not an array'],
    ['a non-string ref', { 'left-pad': [null] }, '[0] is not a name@ref string'],
    ['a missing integrity', { 'left-pad': ['left-pad@1.3.0', '', {}] }, 'last element is not a sha512- integrity'],
  ])('fails malformed packages data (%s)', (_name, packages, message) => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeLock(root, /** @type {Record<string, unknown>} */ (packages))
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain(message)
  })

  it('fails closed on a control character in bun pm untrusted output', () => {
    const result = checkLockfile(fixture('clean', {
      untrustedOutput: 'bun pm untrusted v1.3.14 (0d9b296a)\n\u0000unexpected\n',
    }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unrecognized output line')
  })

  it('fails closed on an unpaired surrogate in bun pm untrusted output', () => {
    const result = checkLockfile(fixture('clean', {
      untrustedOutput: 'bun pm untrusted v1.3.14 (0d9b296a)\n\uD800\n',
    }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unrecognized output line')
  })

  it('rejects a very long ref without crashing', () => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeLock(root, { evil: [`evil@${'a'.repeat(200000)}`, '', {}, 'sha512-abc'] })
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unsupported ref')
  })

  it('treats a __proto__ package key as data', () => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeFileSync(path.join(root, 'bun.lock'), `{
  "lockfileVersion": 1,
  "configVersion": 0,
  "packages": {
    "__proto__": ["left-pad@1.3.0", "", {}, "sha512-abc"],
  },
}
`)
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('fails a default-trusted package that is not on the allowlist', () => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeLock(root, { sharp: ['sharp@0.34.0', '', {}, 'sha512-abc'] })
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('sharp@0.34.0')
    expect(result.errors.join('\n')).toContain('ALLOWED_DEFAULT_TRUSTED')
  })

  it('passes a seeded default-trusted package at the locked version', () => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeLock(root, { esbuild: ['esbuild@0.28.2', '', {}, 'sha512-abc'] })
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('fails a default-trusted package at another version', () => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeLock(root, { esbuild: ['esbuild@0.28.3', '', {}, 'sha512-abc'] })
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('esbuild@0.28.3')
    expect(result.errors.join('\n')).toContain('ALLOWED_DEFAULT_TRUSTED')
  })

  it('fails closed when bun pm default-trusted output is not understood', () => {
    const result = checkLockfile(fixture('clean', {
      untrustedOutput: '',
      defaultTrustedOutput: 'WARNING: the output format changed\n',
    }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('bun pm default-trusted: unrecognized output line')
  })

  it('fails an unlisted .npmrc with a registry', () => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeFileSync(path.join(root, '.npmrc'), 'registry=https://evil.example/\n')
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('.npmrc')
    expect(result.errors.join('\n')).toContain('ALLOWED_REGISTRY_FILES')
  })

  it('fails an unlisted bunfig.toml with a registry', () => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeFileSync(path.join(root, 'bunfig.toml'), '[install]\nregistry = "https://evil.example/"\n')
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('bunfig.toml')
    expect(result.errors.join('\n')).toContain('ALLOWED_REGISTRY_FILES')
  })

  it('fails an unlisted registry file inside a workspace', () => {
    const { root, defaultTrustedOutput } = fixture('workspace-declared')
    writeFileSync(path.join(root, 'packages/core/.npmrc'), 'registry=https://evil.example/\n')
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('packages/core/.npmrc')
  })

  it('passes allowlisted registry configuration files', () => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeFileSync(path.join(root, '.npmrc'), 'registry=https://evil.example/\n')
    writeFileSync(path.join(root, 'bunfig.toml'), '[install]\nregistry = "https://evil.example/"\n')
    const result = checkLockfile({
      root,
      untrustedOutput: '',
      defaultTrustedOutput,
      registryFileAllowlist: [
        { path: '.npmrc', reason: 'test' },
        { path: 'bunfig.toml', reason: 'test' },
      ],
    })
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.stats).toMatchObject({ registryFiles: 2 })
  })

  it.each([
    ['evil@link:x@workspace:packages/core'],
    ['x@git+ssh://git@h/x.git@1.0.0'],
  ])('fails a ref with a second @ in the JSON layer (%s)', (first) => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeLock(root, { evil: [first, '', {}, 'sha512-abc'] })
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('ref must not contain "@"')
  })

  it('fails a ref with a colon outside workspace:', () => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeLock(root, { evil: ['evil@file:/tmp/evil.tgz', '', {}, 'sha512-abc'] })
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unsupported ref "file:/tmp/evil.tgz"')
  })

  it('fails a non-registry source hidden behind a JSON escape', () => {
    const { root, defaultTrustedOutput } = fixture('clean')
    writeFileSync(path.join(root, 'bun.lock'), `{
  "lockfileVersion": 1,
  "configVersion": 0,
  "packages": {
    "left-pad": ["left-pad@1.3.0", "\\u0068ttps://evil.example/left-pad.tgz", {}, "sha512-abc"],
  },
}
`)
    const result = checkLockfile({ root, untrustedOutput: '', defaultTrustedOutput })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('non-registry source "https://"')
  })

  it('warns when node_modules is missing locally', () => {
    const result = checkLockfile({ ...fixture('clean'), ci: false })
    expect(result.ok).toBe(true)
    expect(result.warnings.join('\n')).toContain('node_modules is missing')
    expect(result.stats.installScriptsSkipped).toBe(true)
  })

  it('fails when node_modules is missing in CI', () => {
    const result = checkLockfile({ ...fixture('clean'), ci: true })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('node_modules is missing')
  })

  it('runs through a junction and fails a bad lock', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'laratype-check-lockfile-'))
    const link = `${root}-link`
    roots.push(root)
    try {
      mkdirSync(path.join(root, 'scripts'))
      copyFileSync(path.join(REPO_ROOT, 'scripts/check-lockfile.mjs'), path.join(root, 'scripts/check-lockfile.mjs'))
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }))
      writeFileSync(path.join(root, 'bun.lock'), '{\n  "lockfileVersion": 1,\n  "configVersion": 0,\n}\n')
      symlinkSync(root, link, 'junction')
      const result = spawnSync(process.execPath, [path.join(link, 'scripts/check-lockfile.mjs')], { encoding: 'utf-8' })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('"packages" is missing or not an object')
    }
    finally {
      if (existsSync(link)) {
        try {
          rmdirSync(link)
        }
        catch {
          unlinkSync(link)
        }
      }
    }
  })

  it('throws when bun.lock is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'laratype-check-lockfile-'))
    roots.push(root)
    expect(() => checkLockfile({ root, untrustedOutput: '' })).toThrow(/cannot read bun\.lock/)
  })
})
