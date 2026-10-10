import type { Options } from '@swc/core';

/** Exactly the RollupPluginSwc options from packages/sauf/src/bin/warmup.ts. */
export const warmupSwcOptions = (overrides: { decoratorMetadata?: boolean } = {}): Options => ({
  sourceMaps: true,
  module: {
    type: 'es6',
  },
  jsc: {
    target: 'es2022',
    parser: {
      syntax: 'typescript',
      decorators: true,
      tsx: false,
    },
    transform: {
      legacyDecorator: true,
      decoratorMetadata: overrides.decoratorMetadata ?? true,
    },
  },
});
