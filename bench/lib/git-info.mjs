/**
 * Commit metadata for the report.
 *
 * The Docker build context excludes `.git`, so the container cannot run `git`. CI passes the checked-out commit as
 * `BENCH_GIT_SHA` / `BENCH_GIT_BRANCH` (and `BENCH_GIT_DIRTY=1` if the tree was dirty); `read` is the local fallback.
 * Pure given `read`, so a unit test covers all three branches without spawning git.
 */
export function resolveGitInfo(env, read) {
  const sha = typeof env.BENCH_GIT_SHA === 'string' ? env.BENCH_GIT_SHA.trim() : ''
  if (sha !== '') {
    return {
      sha,
      branch: typeof env.BENCH_GIT_BRANCH === 'string' && env.BENCH_GIT_BRANCH.trim() !== '' ? env.BENCH_GIT_BRANCH.trim() : 'unknown',
      dirty: env.BENCH_GIT_DIRTY === '1',
    }
  }
  try {
    return read()
  } catch {
    return { sha: 'unknown', branch: 'unknown', dirty: true }
  }
}
