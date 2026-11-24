// @ts-check
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_SUMMARY_LENGTH,
  ReleaseError,
  assertSummary,
  checkWorkspace,
  distTagFor,
  fixedVersion,
  nextVersion,
  parseChangeset,
  readChangesets,
  readPre,
  readWorkspace,
  removePre,
  writeChangeset,
  writePre,
  writeRelease,
} from '../lib.js'

/** @type {string[]} */
const roots = []

/**
 * A minimal workspace on disk: one `packages/<dir>/package.json` per entry plus the root package.json.
 * @param {Record<string, { version?: string, private?: boolean, name?: string, src?: boolean }>} packages
 * @param {string} rootVersion
 */
function makeWorkspace(packages, rootVersion) {
  const root = mkdtempSync(path.join(tmpdir(), 'laratype-release-'))
  roots.push(root)
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ version: rootVersion, private: true }, null, 2)}\n`)
  for (const [dir, options] of Object.entries(packages)) {
    const pkgDir = path.join(root, 'packages', dir)
    mkdirSync(pkgDir, { recursive: true })
    const pkg = {
      name: Object.hasOwn(options, 'name') ? options.name : `@laratype/${dir}`,
      version: options.version ?? rootVersion,
      ...(options.private === undefined ? {} : { private: options.private }),
    }
    writeFileSync(path.join(pkgDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
    if (options.src) {
      mkdirSync(path.join(pkgDir, 'src'))
      writeFileSync(path.join(pkgDir, 'src', 'index.ts'), 'export {}\n')
    }
  }
  return root
}

/**
 * @param {string} name
 * @param {boolean} [isPrivate]
 */
function packagesMap(name = '@laratype/http', isPrivate = false) {
  return new Map([[name, { name, private: isPrivate }]])
}

const valid = '---\n"@laratype/http": minor\n---\n\nFix the thing.\n'

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('assertSummary', () => {
  it('accepts a normal summary', () => {
    expect(assertSummary('Fix the thing.')).toBe('Fix the thing.')
  })

  it('rejects a non-string summary', () => {
    expect(() => assertSummary(null)).toThrow(ReleaseError)
    expect(() => assertSummary(42)).toThrow(ReleaseError)
  })

  it('rejects an empty or whitespace-only summary', () => {
    expect(() => assertSummary('')).toThrow(/must not be empty/)
    expect(() => assertSummary(' \n\t ')).toThrow(/must not be empty/)
  })

  it(`accepts ${MAX_SUMMARY_LENGTH} characters and rejects ${MAX_SUMMARY_LENGTH + 1}`, () => {
    expect(assertSummary('a'.repeat(MAX_SUMMARY_LENGTH))).toHaveLength(MAX_SUMMARY_LENGTH)
    expect(() => assertSummary('a'.repeat(MAX_SUMMARY_LENGTH + 1))).toThrow(/limit is 2000/)
  })

  it('rejects control characters but allows newline and tab', () => {
    expect(assertSummary('line one\nline\ttwo')).toBe('line one\nline\ttwo')
    expect(() => assertSummary('bell \u0007')).toThrow(/control characters/)
    expect(() => assertSummary('nul \u0000')).toThrow(/control characters/)
    expect(() => assertSummary('lone \r cr')).toThrow(/control characters/)
  })

  it('rejects lone surrogates and keeps valid astral characters', () => {
    expect(assertSummary('ok 😀')).toBe('ok 😀')
    expect(() => assertSummary('high \uD800')).toThrow(/unpaired UTF-16 surrogate/)
    expect(() => assertSummary('low \uDC00')).toThrow(/unpaired UTF-16 surrogate/)
  })
})

describe('parseChangeset', () => {
  it('parses one or more releases and the summary', () => {
    expect(parseChangeset(valid, packagesMap())).toEqual({
      releases: [{ name: '@laratype/http', bump: 'minor' }],
      summary: 'Fix the thing.',
    })
    expect(
      parseChangeset('---\n"@laratype/http": patch\nsauf: major\n---\n\nBody\n', new Map([
        ['@laratype/http', { name: '@laratype/http', private: false }],
        ['sauf', { name: 'sauf', private: false }],
      ])),
    ).toEqual({
      releases: [{ name: '@laratype/http', bump: 'patch' }, { name: 'sauf', bump: 'major' }],
      summary: 'Body',
    })
  })

  it('accepts CRLF files and normalizes them', () => {
    const crlf = '---\r\n"@laratype/http": minor\r\n---\r\n\r\nBody\r\n'
    expect(parseChangeset(crlf, packagesMap()).summary).toBe('Body')
  })

  it('rejects unknown packages and private packages', () => {
    expect(() => parseChangeset(valid, new Map())).toThrow(/unknown or private package/)
    expect(() => parseChangeset(valid, packagesMap('@laratype/http', true))).toThrow(/unknown or private package/)
  })

  it('rejects unknown bump levels', () => {
    expect(() => parseChangeset('---\n"@laratype/http": huge\n---\n\nBody\n', packagesMap())).toThrow(/bump for "@laratype\/http" must be one of patch, minor, major/)
  })

  it('rejects __proto__, constructor and prototype keys without polluting prototypes', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(() => parseChangeset(`---\n${key}: minor\n---\n\nBody\n`, packagesMap(key))).toThrow(/not allowed/)
    }
    expect(/** @type {any} */ ({}).polluted).toBeUndefined()
  })

  it('rejects empty front matter, a missing front matter and a missing closing line', () => {
    expect(() => parseChangeset('---\n---\n\nBody\n', packagesMap())).toThrow(/front matter is empty/)
    expect(() => parseChangeset('Body\n', packagesMap())).toThrow(/must start with a "---"/)
    expect(() => parseChangeset('---\n"@laratype/http": minor\n\nBody\n', packagesMap())).toThrow(/no closing "---"/)
  })

  it('rejects a package named twice in one file', () => {
    expect(() => parseChangeset('---\n"@laratype/http": minor\n"@laratype/http": patch\n---\n\nBody\n', packagesMap())).toThrow(/more than once/)
  })

  it('rejects malformed front-matter lines', () => {
    expect(() => parseChangeset('---\n@laratype/http minor\n---\n\nBody\n', packagesMap())).toThrow(/malformed front-matter line/)
  })

  it('rejects non-string sources and an empty summary', () => {
    expect(() => parseChangeset(null, packagesMap())).toThrow(/must be a string/)
    expect(() => parseChangeset(42, packagesMap())).toThrow(/must be a string/)
    expect(() => parseChangeset('---\n"@laratype/http": minor\n---\n\n   \n', packagesMap())).toThrow(/must not be empty/)
  })

  it('rejects a summary over the limit, a control character and a lone surrogate', () => {
    const long = `---\n"@laratype/http": minor\n---\n\n${'a'.repeat(MAX_SUMMARY_LENGTH + 1)}\n`
    expect(() => parseChangeset(long, packagesMap())).toThrow(/limit is 2000/)
    expect(() => parseChangeset('---\n"@laratype/http": minor\n---\n\nbell \u0007\n', packagesMap())).toThrow(/control characters/)
    expect(() => parseChangeset('---\n"@laratype/http": minor\n---\n\nlone \uD800\n', packagesMap())).toThrow(/unpaired UTF-16 surrogate/)
  })
})

describe('nextVersion', () => {
  it('bumps a stable version by patch, minor and major', () => {
    expect(nextVersion({ current: '0.5.4', pre: null, releases: [{ bump: 'patch' }] })).toBe('0.5.5')
    expect(nextVersion({ current: '0.5.4', pre: null, releases: [{ bump: 'minor' }] })).toBe('0.6.0')
    expect(nextVersion({ current: '0.5.4', pre: null, releases: [{ bump: 'major' }] })).toBe('1.0.0')
    expect(nextVersion({ current: '1.0.0', pre: null, releases: [{ bump: 'minor' }] })).toBe('1.1.0')
  })

  it('returns null when there is nothing to release', () => {
    expect(nextVersion({ current: '0.5.4', pre: null, releases: [] })).toBeNull()
    expect(nextVersion({ current: '1.0.0-alpha.1', pre: { base: '1.0.0' }, releases: [] })).toBeNull()
  })

  it('starts a pre line at alpha.0 and increments it per changeset', () => {
    expect(nextVersion({ current: '0.5.4', pre: { base: '1.0.0' }, releases: [{ bump: 'minor' }] })).toBe('1.0.0-alpha.0')
    expect(nextVersion({ current: '1.0.0-alpha.0', pre: { base: '1.0.0' }, releases: [{ bump: 'patch' }] })).toBe('1.0.0-alpha.1')
    expect(nextVersion({ current: '1.0.0-alpha.9', pre: { base: '1.0.0' }, releases: [{ bump: 'major' }] })).toBe('1.0.0-alpha.10')
  })

  it('writes the stable version after leaving pre mode', () => {
    expect(nextVersion({ current: '1.0.0-alpha.1', pre: null, releases: [] })).toBe('1.0.0')
    expect(nextVersion({ current: '1.0.0-alpha.1', pre: null, releases: [{ bump: 'minor' }] })).toBe('1.1.0')
  })

  it('rejects inconsistent pre-mode states', () => {
    expect(() => nextVersion({ current: '1.0.0', pre: { base: '1.0.0' }, releases: [{ bump: 'minor' }] })).toThrow(/already released/)
    expect(() => nextVersion({ current: '2.0.0-alpha.0', pre: { base: '1.0.0' }, releases: [{ bump: 'minor' }] })).toThrow(/run release:pre-exit first/)
    expect(() => nextVersion({ current: '2.0.0', pre: { base: '1.0.0' }, releases: [{ bump: 'minor' }] })).toThrow(/must be greater/)
    expect(() => nextVersion({ current: '2.0.0', pre: { base: '1.0.0' }, releases: [] })).toThrow(/must be greater/)
  })

  it('rejects invalid input types and bump levels', () => {
    expect(() => nextVersion({ current: 'nope', pre: null, releases: [] })).toThrow(/invalid current version/)
    expect(() => nextVersion({ current: '1.0.0', pre: null, releases: /** @type {any} */ ('minor') })).toThrow(/releases must be an array/)
    expect(() => nextVersion({ current: '1.0.0', pre: null, releases: [{ bump: 'huge' }] })).toThrow(/unknown bump level/)
  })
})

describe('distTagFor', () => {
  it('maps stable versions to latest and alpha prereleases to alpha', () => {
    expect(distTagFor('1.0.0')).toBe('latest')
    expect(distTagFor('1.0.0-alpha.0')).toBe('alpha')
    expect(distTagFor('1.0.0-alpha.10')).toBe('alpha')
  })

  it('rejects every other prerelease or invalid version', () => {
    expect(() => distTagFor('1.0.0-beta.0')).toThrow(/only configured prerelease dist-tag is alpha/)
    expect(() => distTagFor('1.0.0-alpha')).toThrow(/only configured prerelease dist-tag is alpha/)
    expect(() => distTagFor('1.0.0+build')).toThrow(/invalid semver/)
    expect(() => distTagFor('nope')).toThrow(/invalid semver/)
  })
})

describe('workspace reading and checking', () => {
  it('reads packages and enforces one fixed version', () => {
    const root = makeWorkspace({ http: { src: true }, sauf: { src: true } }, '1.0.0')
    const workspace = readWorkspace(root)
    expect(fixedVersion(workspace)).toBe('1.0.0')
    mkdirSync(path.join(root, '.changeset'))
    expect(readPre(root)).toBeNull()
  })

  it('rejects invalid package metadata and duplicate names', () => {
    const badVersion = makeWorkspace({ http: { version: /** @type {any} */ (1) } }, '1.0.0')
    expect(() => readWorkspace(badVersion)).toThrow(/semver string/)
    const badPrivate = makeWorkspace({ http: { private: /** @type {any} */ ('yes') } }, '1.0.0')
    expect(() => readWorkspace(badPrivate)).toThrow(/"private" must be a boolean/)
    const badName = makeWorkspace({ http: { name: /** @type {any} */ (null) } }, '1.0.0')
    expect(() => readWorkspace(badName)).toThrow(/"name" must be a non-empty string/)
    const duplicate = makeWorkspace({ one: { name: '@laratype/http' }, two: { name: '@laratype/http' } }, '1.0.0')
    expect(() => readWorkspace(duplicate)).toThrow(/duplicate package name/)
  })

  it('fails a public package without src/ and accepts a private one', () => {
    const root = makeWorkspace({ empty: { private: false }, privateEmpty: { private: true }, http: { src: true } }, '1.0.0')
    expect(() => checkWorkspace(root)).toThrow(/no src\/ and must be "private": true/)
    const fixed = makeWorkspace({ empty: { private: true }, http: { src: true } }, '1.0.0')
    expect(checkWorkspace(fixed)).toMatchObject({ version: '1.0.0', distTag: 'latest', pre: null })
  })

  it('checks the expected version and the pre-mode file', () => {
    const root = makeWorkspace({ http: { src: true } }, '1.0.0')
    expect(() => checkWorkspace(root, { expectedVersion: '2.0.0' })).toThrow(/not the expected 2.0.0/)
    mkdirSync(path.join(root, '.changeset'))
    writeFileSync(path.join(root, '.changeset', 'pre.json'), JSON.stringify({ mode: 'pre', tag: 'beta', base: '1.0.0' }))
    expect(() => checkWorkspace(root)).toThrow(/"tag" must be "alpha"/)
    writeFileSync(path.join(root, '.changeset', 'pre.json'), JSON.stringify({ mode: 'pre', tag: 'alpha', base: '1.0.0-alpha.0' }))
    expect(() => checkWorkspace(root)).toThrow(/"base" must be a stable semver/)
  })

  it('requires pre.json while the tree is a prerelease', () => {
    const root = makeWorkspace({ http: { src: true } }, '1.0.0-alpha.0')
    expect(() => checkWorkspace(root)).toThrow(/is a prerelease but .changeset\/pre\.json is missing/)
    mkdirSync(path.join(root, '.changeset'))
    writePre(root, '1.0.0')
    expect(checkWorkspace(root)).toMatchObject({ version: '1.0.0-alpha.0', distTag: 'alpha' })
  })

  it('writes and removes pre.json', () => {
    const root = makeWorkspace({ http: { src: true } }, '0.5.4')
    const file = writePre(root, '1.0.0')
    expect(readPre(root)).toEqual({ mode: 'pre', tag: 'alpha', base: '1.0.0' })
    expect(() => writePre(root, '1.1.0')).toThrow(/already exists/)
    expect(removePre(root)).toBe(file)
    expect(() => removePre(root)).toThrow(/not in pre mode/)
    expect(() => writePre(root, '1.0.0-alpha.0')).toThrow(/stable semver/)
  })
})

describe('writeChangeset', () => {
  it('writes a generated file name inside .changeset', () => {
    const root = makeWorkspace({ http: { src: true } }, '0.5.4')
    const file = writeChangeset(root, { name: '@laratype/http', bump: 'minor', summary: 'Fix the thing.' })
    expect(path.dirname(file)).toBe(path.join(root, '.changeset'))
    expect(path.basename(file)).toMatch(/^laratype-http-minor-[0-9a-f]{8}\.md$/)
    expect(readFileSync(file, 'utf8')).toBe('---\n"@laratype/http": minor\n---\n\nFix the thing.\n')
    expect(readChangesets(root, new Map([['@laratype/http', { name: '@laratype/http', private: false }]]))).toHaveLength(1)
  })

  it('never lets a user-supplied name become a path', () => {
    const root = makeWorkspace({ http: { src: true } }, '0.5.4')
    expect(() => writeChangeset(root, { name: '../../evil', bump: 'minor', summary: 'x' })).toThrow(/unknown package/)
    expect(existsSync(path.join(root, 'evil.md'))).toBe(false)
    expect(existsSync(path.join(path.dirname(root), 'evil.md'))).toBe(false)
    expect(existsSync(path.join(root, '.changeset'))).toBe(false)
  })

  it('rejects private packages, unknown bumps and bad summaries', () => {
    const root = makeWorkspace({ http: { src: true }, empty: { private: true } }, '0.5.4')
    expect(() => writeChangeset(root, { name: '@laratype/empty', bump: 'minor', summary: 'x' })).toThrow(/private and is never published/)
    expect(() => writeChangeset(root, { name: '@laratype/http', bump: 'huge', summary: 'x' })).toThrow(/bump must be one of/)
    expect(() => writeChangeset(root, { name: '@laratype/http', bump: 'minor', summary: '' })).toThrow(/must not be empty/)
    expect(() => writeChangeset(root, { name: /** @type {any} */ (42), bump: 'minor', summary: 'x' })).toThrow(/package name must be a string/)
  })
})

describe('writeRelease', () => {
  it('writes the version, changelog and removes the applied changesets', () => {
    const root = makeWorkspace({ http: { src: true }, sauf: { src: true } }, '1.0.0')
    writeChangeset(root, { name: '@laratype/http', bump: 'minor', summary: 'Add a thing.' })
    const workspace = readWorkspace(root)
    const changesets = readChangesets(root, new Map([['@laratype/http', { name: '@laratype/http', private: false }]]))
    expect(writeRelease({ root, workspace, version: '1.1.0', changesets, date: '2026-11-24' })).toBe('1.1.0')

    for (const file of ['package.json', 'packages/http/package.json', 'packages/sauf/package.json']) {
      expect(JSON.parse(readFileSync(path.join(root, file), 'utf8')).version).toBe('1.1.0')
    }
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
    expect(changelog).toContain('# Changelog')
    expect(changelog).toContain('## 1.1.0 (2026-11-24)')
    expect(changelog).toContain('### @laratype/http')
    expect(changelog).toContain('Add a thing.')
    expect(existsSync(changesets[0].file)).toBe(false)
    expect(readFileSync(path.join(root, 'package.json'), 'utf8')).not.toContain('"version": "1.0.0"')
  })

  it('prepends a new section and keeps the older one', () => {
    const root = makeWorkspace({ http: { src: true } }, '1.0.0')
    writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 (2026-01-01)\n\nOld.\n')
    writeChangeset(root, { name: '@laratype/http', bump: 'patch', summary: 'New.' })
    const workspace = readWorkspace(root)
    const changesets = readChangesets(root, new Map([['@laratype/http', { name: '@laratype/http', private: false }]]))
    writeRelease({ root, workspace, version: '1.0.1', changesets, date: '2026-11-24' })
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
    expect(changelog.indexOf('## 1.0.1')).toBeLessThan(changelog.indexOf('## 1.0.0'))
    expect(changelog).toContain('Old.')
  })

  it('fails on mismatched versions without writing anything', () => {
    const root = makeWorkspace({ http: { version: '1.0.0' }, sauf: { version: '1.1.0' } }, '1.0.0')
    mkdirSync(path.join(root, '.changeset'))
    writeFileSync(path.join(root, '.changeset', 'x.md'), '---\n"@laratype/http": minor\n---\n\nX\n')
    const before = ['package.json', 'packages/http/package.json', 'packages/sauf/package.json'].map((file) => readFileSync(path.join(root, file), 'utf8'))
    const workspace = readWorkspace(root)
    const changesets = readChangesets(root, new Map([['@laratype/http', { name: '@laratype/http', private: false }]]))
    expect(() => writeRelease({ root, workspace, version: '2.0.0', changesets, date: '2026-11-24' })).toThrow(/fixed versioning needs one version/)
    const after = ['package.json', 'packages/http/package.json', 'packages/sauf/package.json'].map((file) => readFileSync(path.join(root, file), 'utf8'))
    expect(after).toEqual(before)
    expect(existsSync(path.join(root, 'CHANGELOG.md'))).toBe(false)
    expect(existsSync(path.join(root, '.changeset', 'x.md'))).toBe(true)
  })

  it('rejects the current version and an invalid target', () => {
    const root = makeWorkspace({ http: { src: true } }, '1.0.0')
    const workspace = readWorkspace(root)
    expect(() => writeRelease({ root, workspace, version: '1.0.0', changesets: [], date: '2026-11-24' })).toThrow(/already at 1.0.0/)
    expect(() => writeRelease({ root, workspace, version: '1.1.0-beta.0', changesets: [], date: '2026-11-24' })).toThrow(/only configured prerelease dist-tag is alpha/)
  })
})
