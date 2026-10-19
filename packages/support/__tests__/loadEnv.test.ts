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
    delete process.env.H1_OTHER_SECRET
    delete process.env.H1_OWN_VALUE
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
})
