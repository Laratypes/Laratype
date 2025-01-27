import { defineConfig } from 'vitest/config'
import { entries } from './scripts/alias'

export default defineConfig({
  resolve: {
    alias: entries,
  },
  test: {
    alias: entries,
    coverage: {
      include: ['packages/*/src/**'],
    }
  },

})