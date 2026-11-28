import { describe, expect, it } from 'vitest'
import { resolveGitInfo } from '../lib/git-info.mjs'

const read = () => ({ sha: 'local-sha', branch: 'local-branch', dirty: true })

describe('resolveGitInfo', () => {
  it('uses the BENCH_GIT_* environment and reports a clean tree by default', () => {
    // CI runs the bench in a container whose build context has no .git.
    expect(resolveGitInfo({ BENCH_GIT_SHA: 'abc123', BENCH_GIT_BRANCH: 'build/b26-bench-phase1' }, read)).toEqual({
      sha: 'abc123',
      branch: 'build/b26-bench-phase1',
      dirty: false,
    })
  })

  it('takes dirty from BENCH_GIT_DIRTY and a missing branch as unknown', () => {
    expect(resolveGitInfo({ BENCH_GIT_SHA: 'abc123', BENCH_GIT_DIRTY: '1' }, read)).toEqual({ sha: 'abc123', branch: 'unknown', dirty: true })
  })

  it('falls back to the local reader when no SHA is passed', () => {
    expect(resolveGitInfo({}, read)).toEqual({ sha: 'local-sha', branch: 'local-branch', dirty: true })
    expect(resolveGitInfo({ BENCH_GIT_SHA: '   ' }, read)).toEqual({ sha: 'local-sha', branch: 'local-branch', dirty: true })
  })

  it('reports an unknown commit when git is unavailable', () => {
    const failing = () => {
      throw new Error('git: not found')
    }
    expect(resolveGitInfo({}, failing)).toEqual({ sha: 'unknown', branch: 'unknown', dirty: true })
  })
})
