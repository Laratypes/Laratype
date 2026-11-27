import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadEnv } from '../src/environ'

describe('loadEnv', () => {
  const dirs: string[] = []
  // The runner sets NODE_ENV, and K4's loader reads it: every test starts from none and restores the original after
  const savedNodeEnv = process.env.NODE_ENV
  const tmp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'laratype-env-'))
    dirs.push(dir)
    return dir
  }

  beforeEach(() => {
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = savedNodeEnv
    vi.restoreAllMocks()
    for (const name of [
      'H1_OTHER_SECRET',
      'H1_OWN_VALUE',
      'H1_BRACKET_VALUE',
      'H1_WILDCARD_VALUE',
      'H1_PRECEDENCE',
      'H1_LOCAL_WINS',
      'H1_MODE_ORDER',
      'H1_CWD_MODE',
      'H1_FILES_ONLY',
      'K4_FALLBACK_EXAMPLE',
      'K4_FALLBACK_PROD',
      'K4_FALLBACK_TEMPLATE',
      'K4_FALLBACK_UPPER',
      'K4_FALLBACK_LEAKED',
      'K4_FALLBACK_SAFE',
      'K4_FALLBACK_DIR',
    ]) delete process.env[name]
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it("with a projectDir that has no env file, loads nothing, not the current directory's .env", () => {
    const cwd = tmp()
    writeFileSync(join(cwd, '.env'), 'H1_OTHER_SECRET=leaked\n')
    const project = join(tmp(), 'project')
    mkdirSync(project)
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    const before = globalThis.__laratype_env_file
    expect(loadEnv(project)).toBeUndefined()
    expect(process.env.H1_OTHER_SECRET).toBeUndefined()
    expect(globalThis.__laratype_env_file).toBe(before)
  })

  it("loads the projectDir's own .env", () => {
    const project = tmp()
    writeFileSync(join(project, '.env'), 'H1_OWN_VALUE=mine\n')
    expect(loadEnv(project)).toBe(join(project, '.env'))
    expect(process.env.H1_OWN_VALUE).toBe('mine')
  })

  it('lists a project directory whose name has a glob metacharacter, instead of reading it as a pattern', () => {
    // NODE_ENV is unset, and no .env/.env.local exists, so only the .env.* discovery can select this file
    delete process.env.NODE_ENV
    const project = join(tmp(), 'project[1]')
    mkdirSync(project)
    writeFileSync(join(project, '.env.production'), 'H1_BRACKET_VALUE=bracket\n')
    expect(loadEnv(project)).toBe(join(project, '.env.production'))
    expect(process.env.H1_BRACKET_VALUE).toBe('bracket')
  })

  it.skipIf(process.platform === 'win32')('lists a project directory whose name has * and ? as well', () => {
    // Windows file names cannot contain * or ?; POSIX directories can
    // NODE_ENV is unset, and no .env/.env.local exists, so only the .env.* discovery can select this file
    delete process.env.NODE_ENV
    const project = join(tmp(), 'project*?')
    mkdirSync(project)
    writeFileSync(join(project, '.env.production'), 'H1_WILDCARD_VALUE=wildcard\n')
    expect(loadEnv(project)).toBe(join(project, '.env.production'))
    expect(process.env.H1_WILDCARD_VALUE).toBe('wildcard')
  })

  it('with a projectDir that does not exist, loads nothing (as the glob did)', () => {
    const project = join(tmp(), 'missing')
    expect(() => loadEnv(project)).not.toThrow()
    expect(loadEnv(project)).toBeUndefined()
  })

  it('rejects a non-string projectDir, as path.resolve did before', () => {
    expect(() => loadEnv(123 as unknown as string)).toThrow(TypeError)
  })

  it('keeps .env over .env.local over .env.<mode>', () => {
    const project = tmp()
    writeFileSync(join(project, '.env'), 'H1_PRECEDENCE=dotenv\n')
    writeFileSync(join(project, '.env.local'), 'H1_PRECEDENCE=local\n')
    writeFileSync(join(project, '.env.production'), 'H1_PRECEDENCE=production\n')
    expect(loadEnv(project)).toBe(join(project, '.env'))
    expect(process.env.H1_PRECEDENCE).toBe('dotenv')
  })

  it('keeps .env.local over .env.<mode>', () => {
    const project = tmp()
    writeFileSync(join(project, '.env.local'), 'H1_LOCAL_WINS=local\n')
    writeFileSync(join(project, '.env.production'), 'H1_LOCAL_WINS=production\n')
    expect(loadEnv(project)).toBe(join(project, '.env.local'))
    expect(process.env.H1_LOCAL_WINS).toBe('local')
  })

  it('loads the first .env.<mode> in name order', () => {
    const project = tmp()
    writeFileSync(join(project, '.env.production'), 'H1_MODE_ORDER=production\n')
    writeFileSync(join(project, '.env.development'), 'H1_MODE_ORDER=development\n')
    expect(loadEnv(project)).toBe(join(project, '.env.development'))
    expect(process.env.H1_MODE_ORDER).toBe('development')
  })

  it('finds a .env.<mode> without a projectDir, in the current directory', () => {
    const project = tmp()
    writeFileSync(join(project, '.env.staging'), 'H1_CWD_MODE=staging\n')
    vi.spyOn(process, 'cwd').mockReturnValue(project)
    expect(loadEnv()).toBe(join(project, '.env.staging'))
    expect(process.env.H1_CWD_MODE).toBe('staging')
  })

  it('reads files only: a directory named .env.<mode> is not an env file', () => {
    const project = tmp()
    mkdirSync(join(project, '.env.production'))
    expect(loadEnv(project)).toBeUndefined()

    writeFileSync(join(project, '.env.development'), 'H1_FILES_ONLY=file\n')
    // NODE_ENV names the directory: it is skipped, not returned as the loaded file
    process.env.NODE_ENV = 'production'
    expect(loadEnv(project)).toBe(join(project, '.env.development'))
    expect(process.env.H1_FILES_ONLY).toBe('file')
  })

  it('reads files only: a directory named .env or .env.local is not an env file', () => {
    const project = tmp()
    mkdirSync(join(project, '.env'))
    mkdirSync(join(project, '.env.local'))
    writeFileSync(join(project, '.env.production'), 'K4_FALLBACK_DIR=file\n')
    // NODE_ENV is unset, so the name-ordered fallback picks the only regular env file
    expect(loadEnv(project)).toBe(join(project, '.env.production'))
    expect(process.env.K4_FALLBACK_DIR).toBe('file')
  })

  it('prefers .env.<NODE_ENV> over a template file (production over .env.example)', () => {
    const project = tmp()
    writeFileSync(join(project, '.env.example'), 'K4_FALLBACK_EXAMPLE=example\n')
    writeFileSync(join(project, '.env.production'), 'K4_FALLBACK_PROD=production\n')
    process.env.NODE_ENV = 'production'

    expect(loadEnv(project)).toBe(join(project, '.env.production'))
    expect(process.env.K4_FALLBACK_PROD).toBe('production')
    expect(process.env.K4_FALLBACK_EXAMPLE).toBeUndefined()
  })

  it('never falls back to a template: .env.production wins over .env.example with NODE_ENV unset', () => {
    const project = tmp()
    writeFileSync(join(project, '.env.example'), 'K4_FALLBACK_EXAMPLE=example\n')
    writeFileSync(join(project, '.env.production'), 'K4_FALLBACK_PROD=production\n')

    expect(loadEnv(project)).toBe(join(project, '.env.production'))
    expect(process.env.K4_FALLBACK_PROD).toBe('production')
    expect(process.env.K4_FALLBACK_EXAMPLE).toBeUndefined()
  })

  it('loads nothing when only template files exist, and does not throw', () => {
    for (const name of ['.env.example', '.env.sample', '.env.template', '.env.dist']) {
      const project = tmp()
      writeFileSync(join(project, name), 'K4_FALLBACK_TEMPLATE=template\n')
      delete process.env.K4_FALLBACK_TEMPLATE

      expect(() => loadEnv(project)).not.toThrow()
      expect(loadEnv(project)).toBeUndefined()
      expect(process.env.K4_FALLBACK_TEMPLATE).toBeUndefined()
      // NODE_ENV cannot select a template either
      process.env.NODE_ENV = name.slice('.env.'.length)
      expect(loadEnv(project)).toBeUndefined()
      expect(process.env.K4_FALLBACK_TEMPLATE).toBeUndefined()
      delete process.env.NODE_ENV
    }
  })

  it('treats a template name in any case as a template (.env.EXAMPLE)', () => {
    const project = tmp()
    writeFileSync(join(project, '.env.EXAMPLE'), 'K4_FALLBACK_UPPER=example\n')

    expect(loadEnv(project)).toBeUndefined()
    expect(process.env.K4_FALLBACK_UPPER).toBeUndefined()
  })

  it('ignores a NODE_ENV that is not one plain name: it never forms a path outside the project directory', () => {
    const cwd = tmp()
    writeFileSync(join(cwd, '.env'), 'K4_FALLBACK_LEAKED=leaked\n')
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    const project = tmp()
    writeFileSync(join(project, '.env.production'), 'K4_FALLBACK_SAFE=production\n')

    for (const value of [undefined, '', '../x', 'a/b', 'a\\b', '..', '%2e%2e', 'a.b', 'a\u0000b', 'a\u0001b', '\uD800', 'a'.repeat(100_000)]) {
      delete process.env.K4_FALLBACK_LEAKED
      if (value === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = value

      // The mode file is skipped, and the name-ordered fallback stays inside the project directory
      expect(loadEnv(project)).toBe(join(project, '.env.production'))
      expect(process.env.K4_FALLBACK_LEAKED).toBeUndefined()
      expect(process.env.K4_FALLBACK_SAFE).toBe('production')
    }
  })
})
