// @ts-check
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkLockfile } from '../check-lockfile.mjs'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/check-lockfile')
/** @type {string[]} */
const roots = []

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
  return { root, ...options }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('check:lockfile', () => {
  it('passes a clean lock with the known @swc/core install script', () => {
    const result = checkLockfile(fixture('clean', {
      untrustedOutput: '@swc/core @1.13.5\n » [postinstall]: node postinstall.js\n',
    }))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.stats).toMatchObject({ entries: 2, integrity: 1, workspace: 1, installScripts: 1 })
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

  it('fails a package entry without a sha512 integrity', () => {
    const result = checkLockfile(fixture('no-integrity', { untrustedOutput: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('no sha512- integrity')
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
