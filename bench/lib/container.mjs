/**
 * Container-only guard for the benchmark runner.
 *
 * A local run has frozen a developer machine, so `bench/run.mjs` refuses to start unless the image built from
 * `bench/Dockerfile` (or the `bench` workflow, which runs that image) sets the marker. Pure and unit-tested without
 * spawning the runner.
 */

export const CONTAINER_MARKER = 'LARATYPE_BENCH_CONTAINER'

export const CONTAINER_MESSAGE =
  'bench/run.mjs runs only inside bench/Dockerfile (docker build -f bench/Dockerfile .) or the bench workflow; see bench/README.md'

export class ContainerError extends Error {
  constructor(message = CONTAINER_MESSAGE) {
    super(message)
    this.name = 'ContainerError'
  }
}

/**
 * Throws unless `env` marks the bench container. There is no override flag or variable.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {true}
 */
export function assertContainer(env) {
  if (env?.[CONTAINER_MARKER] !== '1') throw new ContainerError()
  return true
}
