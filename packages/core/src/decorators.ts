import { DiError } from './container'
import type { Scope, Token } from './container'
import { getDeps } from './registry'

/** Own-property keys, `Symbol.for` like the deps registry so two copies of `@laratype/core` agree. */
const INJECT = Symbol.for('laratype.di.inject')
const INJECTABLE = Symbol.for('laratype.di.injectable')

export interface InjectableOptions {
  /** Lifetime of the class when it is autowired or bound without an explicit scope. Default `transient`. */
  scope?: Scope
}

const ownValue = <T>(target: Function, key: symbol): T | undefined =>
  Object.prototype.hasOwnProperty.call(target, key) ? (target as unknown as Record<symbol, T>)[key] : undefined

/**
 * Constructor parameter decorator: resolve this param from `token` instead of its type.
 * The DI transform reads it syntactically (`() => TOKEN`); the runtime record covers what the
 * transform can't see (wrapper decorators) and lets the container detect a disagreement.
 */
export function Inject<T>(token: Token<T>) {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number): void => {
    if (propertyKey !== undefined || typeof target !== 'function') {
      throw new DiError(`@Inject() is only supported on constructor parameters (found on \`${String(propertyKey)}\`).`)
    }
    let tokens = ownValue<Map<number, Token>>(target, INJECT)
    if (!tokens) {
      tokens = new Map()
      // Configurable so a re-run of the same module (HMR) can decorate again.
      Object.defineProperty(target, INJECT, { value: tokens, configurable: true, enumerable: false, writable: false })
    }
    tokens.set(parameterIndex, token)
  }
}

/** Class decorator, optional: only needed for a non-default `scope`. Applies to the class itself, not its subclasses. */
export function Injectable(options: InjectableOptions = {}) {
  return (target: Function): void => {
    Object.defineProperty(target, INJECTABLE, { value: { ...options }, configurable: true, enumerable: false, writable: false })
  }
}

/** Scope declared by `@Injectable({ scope })` on `cls` itself. */
export function injectableScope(cls: Function): Scope | undefined {
  return ownValue<InjectableOptions>(cls, INJECTABLE)?.scope
}

/**
 * `@Inject` records (param index → token) of the class whose constructor `cls` uses:
 * `cls` itself, or the ancestor its deps are inherited from.
 */
export function injectTokens(cls: Function): ReadonlyMap<number, Token> | undefined {
  return ownValue(getDeps(cls)?.owner ?? cls, INJECT)
}
