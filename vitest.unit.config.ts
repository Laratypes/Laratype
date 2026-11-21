import { configDefaults, mergeConfig } from 'vitest/config'
import config from './vitest.config'

export default mergeConfig(config, {
  test: {
    name: 'unit',
    // examples/basic has its own project: its app code needs the `laratype:di` transform (vitest.examples.config.ts).
    // examples/fullstack-vue has its own too: its test spawns vue-tsc and owns its .laratype overlay.
    exclude: [...configDefaults.exclude, '**/e2e/**', 'examples/basic/**', 'examples/fullstack-vue/**'],
  },
})
