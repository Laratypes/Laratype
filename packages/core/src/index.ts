export const PACKAGE_NAME = '@laratype/core' as const

export { Container, DiError } from './container'
export type {
  AbstractNewable,
  BindOptions,
  Concrete,
  ContainerOptions,
  Factory,
  Newable,
  Scope,
  Token,
} from './container'
export { Inject, Injectable } from './decorators'
export type { InjectableOptions } from './decorators'
export { InjectionToken, token } from './token'
export { noDeps } from './deps'
export type { DepSlot, DepsEntry, DepsLookup, DepsMeta, UnresolvedSlot } from './deps'
export { __laratype_deps, depsRegistry, getDeps, hasOwnDeps, isAbstract } from './registry'
export { config, defineConfig, setConfigs } from './config'
export type { AppConfigs, ConfigPath, ConfigValue, Register } from './config'
export { defineEnv, ENV_CONFIG_NAME } from './env'
export type { EnvDefinition } from './env'
