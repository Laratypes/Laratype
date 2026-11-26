import { describe, expect, it } from 'vitest'
import { EXPECTED_NODE_VERSION, nodeVersionMismatch } from '../lib/node.mjs'

describe('the bench Node version', () => {
  it('expects the Node pinned by bench/Dockerfile', () => {
    expect(EXPECTED_NODE_VERSION).toBe('22.23.5')
  })

  it('accepts only the matching v-prefixed version', () => {
    expect(nodeVersionMismatch('v22.23.5')).toBe(false)
    expect(nodeVersionMismatch('v20.17.0')).toBe(true)
    expect(nodeVersionMismatch('22.23.5')).toBe(true)
    expect(nodeVersionMismatch('v22.23.50')).toBe(true)
    expect(nodeVersionMismatch('v22.23.5', '22.23.5')).toBe(false)
    expect(nodeVersionMismatch('v1.2.3', '1.2.3')).toBe(false)
  })
})
