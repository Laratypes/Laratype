/**
 * The Node version the bench measures with.
 *
 * `bench/Dockerfile` pins `node:22.23.5-bookworm-slim`; the repo's `.node-version` moves to 22.23.5 in #426, so the
 * bench states its own expectation instead of reading a file that is still 20.17.0 on this branch. Pure, so the
 * `--allow-node-mismatch` check is unit-tested without spawning the runner.
 */
export const EXPECTED_NODE_VERSION = '22.23.5'

/** True when `node --version` (for example `v22.23.5`) is not the bench's Node. */
export function nodeVersionMismatch(actual, expected = EXPECTED_NODE_VERSION) {
  return actual !== `v${expected}`
}
