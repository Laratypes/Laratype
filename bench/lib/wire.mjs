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

/** The autocannon CLI arguments for one measured request. `bodyFile` is only added for a JSON body. */
export function autocannonArgs(scenario, { port, connections, duration, bodyFile }) {
  const args = ['-c', String(connections), '-d', String(duration), '-p', '1', '-j', '-m', scenario.method]
  if (scenario.body) args.push('-H', 'content-type: application/json', '-i', bodyFile)
  args.push(`http://127.0.0.1:${port}${scenario.path}`)
  return args
}
