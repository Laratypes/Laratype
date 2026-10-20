// Type tests for the app manifest (B1 #125): run by `bunx vitest run --project types`.
import { describe, expectTypeOf, test } from 'vitest'
import { appManifest, loadDefault, manifestEntry, setAppManifest } from '../src/manifest/AppManifest'
import type { AppManifest, ManifestEntry, ManifestKind } from '../src/manifest/AppManifest'

describe('AppManifest', () => {
  test('ManifestKind is every list of the manifest, not providers', () => {
    expectTypeOf<ManifestKind>().toEqualTypeOf<'configs' | 'routes' | 'commands' | 'models' | 'migrations' | 'seeders' | 'factories' | 'modules'>()
  })

  test('the lists are read-only entries, providers is optional', () => {
    expectTypeOf<AppManifest['models']>().toEqualTypeOf<readonly ManifestEntry[]>()
    expectTypeOf<AppManifest['providers']>().toEqualTypeOf<ManifestEntry | undefined>()
    expectTypeOf<ManifestEntry['load']>().returns.toEqualTypeOf<Promise<Record<string, any>>>()
  })

  test('setAppManifest takes a manifest, appManifest returns it', () => {
    expectTypeOf(setAppManifest).parameter(0).toEqualTypeOf<AppManifest>()
    expectTypeOf(appManifest).returns.toEqualTypeOf<AppManifest>()
  })

  test('manifestEntry takes a kind and may find nothing', () => {
    expectTypeOf(manifestEntry).parameter(0).toEqualTypeOf<ManifestKind>()
    expectTypeOf(manifestEntry('seeders', 'DatabaseSeeder')).toEqualTypeOf<ManifestEntry | undefined>()
    // @ts-expect-error providers is a single entry, not a kind
    manifestEntry('providers', 'providers')
  })

  test('loadDefault returns its type argument, unknown by default', () => {
    const entry = {} as ManifestEntry
    expectTypeOf(loadDefault<{ name: string }>(entry)).toEqualTypeOf<Promise<{ name: string }>>()
    expectTypeOf(loadDefault(entry)).toEqualTypeOf<Promise<unknown>>()
  })
})
