import { describe, expectTypeOf, it } from 'vitest';
import { laratypeDiBun, type DiBunPlugin, type DiBunPluginOptions, type DiTransformOptions } from '../../src/di';

describe('laratypeDiBun types', () => {
  it('takes the transform options plus `include`, and returns a Bun plugin', () => {
    expectTypeOf(laratypeDiBun).parameter(0).toEqualTypeOf<DiBunPluginOptions | undefined>();
    expectTypeOf<DiBunPluginOptions>().toMatchTypeOf<DiTransformOptions>();
    expectTypeOf<DiBunPluginOptions['include']>().toEqualTypeOf<((path: string) => boolean) | undefined>();
    expectTypeOf(laratypeDiBun()).toEqualTypeOf<DiBunPlugin>();
    expectTypeOf(laratypeDiBun()).toHaveProperty('setup');
  });

  it('rejects unknown options', () => {
    // @ts-expect-error not an option
    laratypeDiBun({ filter: /x/ });
  });
});
