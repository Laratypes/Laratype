import { describe, expect, it } from 'vitest'
import { assertContainer, CONTAINER_MARKER, CONTAINER_MESSAGE, ContainerError } from '../lib/container.mjs'

describe('assertContainer', () => {
  it('accepts only the marker set by bench/Dockerfile', () => {
    expect(assertContainer({ [CONTAINER_MARKER]: '1' })).toBe(true)
  })

  it('refuses a host environment with the documented one-line message', () => {
    expect(() => assertContainer({})).toThrow(ContainerError)
    expect(() => assertContainer({})).toThrow(CONTAINER_MESSAGE)
    expect(CONTAINER_MESSAGE).toBe(
      'bench/run.mjs runs only inside bench/Dockerfile (docker build -f bench/Dockerfile .) or the bench workflow; see bench/README.md',
    )
  })

  it('has no override: any other value, including a falsy-looking one, still refuses', () => {
    for (const value of [undefined, '', '0', 'true', 'yes', '2', ' 1 ']) {
      expect(() => assertContainer({ [CONTAINER_MARKER]: value })).toThrow(CONTAINER_MESSAGE)
    }
    expect(() => assertContainer({})).toThrow(CONTAINER_MESSAGE)
  })
})
