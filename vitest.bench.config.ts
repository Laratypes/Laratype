import { configDefaults, mergeConfig } from "vitest/config";
import config from "./vitest.shared";

/**
 * Fast, server-free checks of the benchmark's pure code (#353): argument parsing, the report tables, the wire
 * fixtures and the commit fallback. `bench/run.mjs` itself is not imported, so no app server, autocannon or Docker
 * is involved. The unit project excludes `bench/**` to keep this project the only one that collects these files.
 */
export default mergeConfig(config, {
  test: {
    name: "bench",
    include: ["bench/__tests__/**/*.test.mjs"],
    exclude: [...configDefaults.exclude],
  },
});
