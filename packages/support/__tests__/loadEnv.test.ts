import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadEnv } from '../src/environ'

describe('loadEnv', () => {
  const dirs: string[] = []
  const tmp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'laratype-env-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
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
    const project = join(tmp(), 'project[1]')
    mkdirSync(project)
    writeFileSync(join(project, '.env'), 'H1_BRACKET_VALUE=bracket\n')
    expect(loadEnv(project)).toBe(join(project, '.env'))
    expect(process.env.H1_BRACKET_VALUE).toBe('bracket')
  })

  it.skipIf(process.platform === 'win32')('lists a project directory whose name has * and ? as well', () => {
    // Windows file names cannot contain * or ?; POSIX directories can
    const project = join(tmp(), 'project*?')
    mkdirSync(project)
    writeFileSync(join(project, '.env'), 'H1_WILDCARD_VALUE=wildcard\n')
    expect(loadEnv(project)).toBe(join(project, '.env'))
    expect(process.env.H1_WILDCARD_VALUE).toBe('wildcard')
  })

  it('with a projectDir that does not exist, loads nothing (as the glob did)', () => {
    const project = join(tmp(), 'missing')
    expect(() => loadEnv(project)).not.toThrow()
    expect(loadEnv(project)).toBeUndefined()
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
    expect(loadEnv(project)).toBe(join(project, '.env.development'))
    expect(process.env.H1_FILES_ONLY).toBe('file')
  })
})
