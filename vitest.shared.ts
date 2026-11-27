import { defineConfig } from 'vitest/config'
import { entries } from './scripts/alias'

// Shared by every project of vitest.config.ts (`test.projects` in vitest 4, where `vitest.workspace.ts` is gone):
// the workspace packages resolve to their `src` in tests and in the type-checked docs examples.
export default defineConfig({
  resolve: {
    alias: entries,
  },
  test: {
    alias: entries,
  },
})
