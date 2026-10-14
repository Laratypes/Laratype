import { mergeConfig } from 'vitest/config'
import config from './vitest.config'

// Type tests (C6 #94): tsc checks *.test-d.ts through tsconfig.typecheck.json, nothing runs at runtime.
// A workspace project, because `--typecheck.*` CLI flags do not reach workspace projects.
export default mergeConfig(config, {
  test: {
    name: 'types',
    typecheck: {
      enabled: true,
      only: true,
      include: ['packages/*/__tests__/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
    },
  },
})
