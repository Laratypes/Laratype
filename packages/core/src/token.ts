/**
 * Typed key for values that have no runtime class (interfaces, primitives, config objects).
 * `T` is only carried in the type, so `container.make(TOKEN)` returns `T`.
 */
export class InjectionToken<T = unknown> {
  /** Phantom field: never set at runtime, only used to carry `T`. */
  declare readonly __type: T

  constructor(readonly name: string) {}

  toString(): string {
    return `InjectionToken(${this.name})`
  }
}

export function token<T>(name: string): InjectionToken<T> {
  return new InjectionToken<T>(name)
}
