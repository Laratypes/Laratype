import { defineConfig } from 'vitest/config'

// Vitest 4 removed the `vitest.workspace.ts` file: the projects are listed here. Each one merges vitest.shared.ts,
// which carries the workspace aliases and the coverage scope.
export default defineConfig({
  test: {
    projects: [
      './vitest.unit.config.ts',
      './vitest.typecheck.config.ts',
      './vitest.examples.config.ts',
      './vitest.fullstack-vue.config.ts',
    ],
  },
})
