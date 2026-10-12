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
export { InjectionToken, token } from './token'
export { noDeps } from './deps'
export type { DepSlot, DepsEntry, DepsLookup, DepsMeta, UnresolvedSlot } from './deps'
