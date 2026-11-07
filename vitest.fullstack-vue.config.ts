import { fileURLToPath } from "node:url";
import { mergeConfig } from "vitest/config";
import config from "./vitest.config";

/**
 * E4 #136's project: examples/fullstack-vue type-checks itself with `vue-tsc` (spawned by its test), so it needs
 * neither the `examples/basic` boot chain (`vitest.examples.config.ts`) nor the app's providers.
 */
const exampleDir = fileURLToPath(new URL("./examples/fullstack-vue", import.meta.url));

export default mergeConfig(config, {
  root: exampleDir,
  test: {
    name: "fullstack-vue",
    root: exampleDir,
    include: ["__tests__/**/*.test.ts"],
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
