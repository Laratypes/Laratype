/**
 * Wire-level helpers shared by the smoke check and the measured run. Pure: no server, no load, no filesystem.
 */

/** The fetch arguments for one scenario request, including the exact JSON body. */
export function requestFor(scenario, port) {
  const headers = scenario.body ? { 'content-type': 'application/json' } : {}
  return [
    `http://127.0.0.1:${port}${scenario.path}`,
    { method: scenario.method, headers, body: scenario.body ? JSON.stringify(scenario.body) : undefined },
  ]
}

/** The smoke contract: status and raw body must match the scenario byte for byte. */
export function responseMatches(scenario, status, body) {
  return status === scenario.expectedStatus && body === scenario.expectedBody
}

/**
 * The smoke deadline. A route that accepts the request and never answers fails that app/runtime at this deadline;
 * without it the job runs until the workflow's 60-minute timeout.
 */
export const SMOKE_TIMEOUT_MS = 5_000

/**
 * One smoke request: the fetch and the body read share one abort deadline, so a hung response (or a stuck body) is a
 * FAIL, not a hang. The extra race bounds a server or stub that ignores the abort signal.
 *
 * `fetchImpl` is injected so the deadline is unit-tested without a server.
 */
export async function smokeRequest(fetchImpl, scenario, port, timeoutMs = SMOKE_TIMEOUT_MS) {
  const [url, init] = requestFor(scenario, port)
  const signal = AbortSignal.timeout(timeoutMs)
  const timeoutError = new Error(`smoke: ${scenario.name} did not answer within ${timeoutMs} ms`)
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), timeoutMs)
    timer.unref?.()
  })
  try {
    const read = (async () => {
      const response = await fetchImpl(url, { ...init, signal })
      const text = await response.text()
      return { status: response.status, text }
    })().catch((error) => {
      // The abort signal and the race deadline are the same instant: report the deadline either way.
      if (signal.aborted) throw timeoutError
      throw error
    })
    return await Promise.race([read, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The measured-run contract of one autocannon result: no connection error and no timeout, at least one completed
 * response, and every completed response carrying the scenario's `expectedStatus` (a 422 scenario stays valid, so
 * `non2xx` alone cannot decide it). Returns `{ ok: true }` or `{ ok: false, reason }`.
 */
export function measurementMatches(scenario, result) {
  const errors = result.errors ?? 0
  if (errors > 0) return { ok: false, reason: `${errors} connection error(s)` }
  const timeouts = result.timeouts ?? 0
  if (timeouts > 0) return { ok: false, reason: `${timeouts} timeout(s)` }

  const counts = Object.entries(result.statusCodeStats ?? {})
    .map(([status, stats]) => [Number(status), Number(stats?.count ?? 0)])
    .filter(([, count]) => count > 0)
  const reported = result.requests?.total
  const completed = Number.isFinite(reported) ? reported : counts.reduce((sum, [, count]) => sum + count, 0)
  if (completed <= 0) return { ok: false, reason: 'no completed responses' }

  const unexpected = counts.filter(([status]) => status !== scenario.expectedStatus)
  if (unexpected.length > 0) {
    const statuses = unexpected.map(([status, count]) => `${status} (${count})`).join(', ')
    return { ok: false, reason: `unexpected status code(s): ${statuses}` }
  }

  const expected = counts.find(([status]) => status === scenario.expectedStatus)?.[1] ?? 0
  if (expected !== completed) {
    return { ok: false, reason: `${expected} of ${completed} completed responses were ${scenario.expectedStatus}` }
  }
  return { ok: true }
}

/** The autocannon CLI arguments for one measured request. `bodyFile` is only added for a JSON body. */
export function autocannonArgs(scenario, { port, connections, duration, bodyFile }) {
  const args = ['-c', String(connections), '-d', String(duration), '-p', '1', '-j', '-m', scenario.method]
  if (scenario.body) args.push('-H', 'content-type: application/json', '-i', bodyFile)
  args.push(`http://127.0.0.1:${port}${scenario.path}`)
  return args
}
