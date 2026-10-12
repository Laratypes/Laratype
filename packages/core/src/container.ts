import { noDeps } from './deps'
import type { DepsLookup } from './deps'
import { InjectionToken } from './token'

export type Newable<T = unknown> = new (...args: any[]) => T
export type AbstractNewable<T = unknown> = abstract new (...args: any[]) => T

/** Anything `make()` accepts: a class (abstract or concrete) or an `InjectionToken`. */
export type Token<T = unknown> = AbstractNewable<T> | InjectionToken<T>

export type Factory<T> = (container: Container) => T

/**
 * What a token is bound to. A function without a `prototype` (arrow function, method) is a factory;
 * anything else is a class that gets autowired.
 */
export type Concrete<T> = Newable<T> | Factory<T>

export type Scope = 'transient' | 'singleton'

export interface BindOptions {
  scope?: Scope
}

export interface ContainerOptions {
  /** Source of constructor dependency metadata. Children inherit the parent's lookup. */
  deps?: DepsLookup
}

export class DiError extends Error {
  override name = 'DiError'
}

interface Binding {
  scope: Scope
  create: (container: Container) => unknown
  resolved?: { value: unknown }
}

const keyName = (key: unknown): string =>
  typeof key === 'function' ? key.name || '<anonymous class>' : String(key)

const isFactory = (concrete: Concrete<unknown>): concrete is Factory<unknown> =>
  concrete.prototype === undefined

export class Container {
  protected readonly bindings = new Map<unknown, Binding>()
  protected readonly parent: Container | undefined
  protected readonly deps: DepsLookup
  /** Keys currently being built, shared by the whole container tree (circular dependency detection). */
  protected readonly resolving: unknown[]

  constructor(options: ContainerOptions = {}, parent?: Container) {
    this.parent = parent
    this.deps = options.deps ?? parent?.deps ?? noDeps
    this.resolving = parent?.resolving ?? []
  }

  /** Bind `token` to a class or factory. Transient unless `scope: 'singleton'`. Omit `concrete` to bind a class to itself. */
  bind<T>(token: Newable<T>, concrete?: undefined, options?: BindOptions): this
  bind<T>(token: Token<T>, concrete: NoInfer<Concrete<T>>, options?: BindOptions): this
  bind(token: Token, concrete?: Concrete<unknown>, options: BindOptions = {}): this {
    return this.register(token, concrete, options.scope ?? 'transient')
  }

  /** Bind `token` once per owning container: the first `make()` result is reused. */
  singleton<T>(token: Newable<T>): this
  singleton<T>(token: Token<T>, concrete: NoInfer<Concrete<T>>): this
  singleton(token: Token, concrete?: Concrete<unknown>): this {
    return this.register(token, concrete, 'singleton')
  }

  /** Bind `token` so every `make()` creates a new value. */
  transient<T>(token: Newable<T>): this
  transient<T>(token: Token<T>, concrete: NoInfer<Concrete<T>>): this
  transient(token: Token, concrete?: Concrete<unknown>): this {
    return this.register(token, concrete, 'transient')
  }

  /** Bind `token` to an existing value. */
  instance<T>(token: Token<T>, value: NoInfer<T>): this {
    this.bindings.set(token, { scope: 'singleton', create: () => value, resolved: { value } })
    return this
  }

  /** Whether `token` is bound in this container or an ancestor (autowirable classes don't count). */
  has(token: Token): boolean {
    return this.findBinding(token) !== undefined
  }

  /** Resolve `token`: its binding (searched up the parent chain), else autowire it if it is a class. */
  make<T>(token: Token<T>): T {
    return this.resolve(token) as T
  }

  /** New container that sees this container's bindings; its own bindings shadow them without affecting this one. */
  createChild(options: ContainerOptions = {}): Container {
    return new Container(options, this)
  }

  protected register(token: Token, concrete: Concrete<unknown> | undefined, scope: Scope): this {
    const target = concrete ?? token
    if (typeof target !== 'function') {
      throw new DiError(`Cannot bind ${keyName(token)} to itself: only a class can be self-bound.`)
    }
    const create = isFactory(target as Concrete<unknown>)
      ? (target as Factory<unknown>)
      : (container: Container) => container.build(target as Newable)
    this.bindings.set(token, { scope, create })
    return this
  }

  protected resolve(key: unknown): unknown {
    const found = this.findBinding(key)
    if (found) {
      const { binding, owner } = found
      if (binding.resolved) return binding.resolved.value
      if (binding.scope === 'singleton') {
        // Built by its owner so a child's overrides never leak into a shared instance.
        const value = owner.withCycleCheck(key, () => binding.create(owner))
        binding.resolved = { value }
        return value
      }
      return this.withCycleCheck(key, () => binding.create(this))
    }
    if (typeof key === 'function') {
      return this.withCycleCheck(key, () => this.build(key as Newable))
    }
    throw new DiError(`No binding for ${keyName(key)}.`)
  }

  /** Construct `cls`, resolving its constructor params from the deps lookup. */
  protected build(cls: Newable): unknown {
    const entry = this.deps.get(cls)
    if (!entry) {
      if (cls.length > 0) {
        throw new DiError(
          `Cannot autowire ${keyName(cls)}: its constructor takes ${cls.length} param(s) but no dependency metadata was found.`,
        )
      }
      return new cls()
    }
    const args = entry.slots.map((slot, index) => {
      const optional = entry.meta?.optional?.includes(index) ?? false
      const param = `${keyName(cls)} constructor param #${index}`
        + (entry.meta?.params[index] ? ` \`${entry.meta.params[index]}\`` : '')
      if (typeof slot !== 'function') {
        if (optional) return undefined
        throw new DiError(`Cannot resolve ${param}: type \`${slot.unresolved}\` has no runtime value.`)
      }
      const dep = slot()
      if (dep === undefined) {
        if (optional) return undefined
        throw new DiError(`Cannot resolve ${param}: its type resolved to undefined at runtime.`)
      }
      return this.resolve(dep)
    })
    return new cls(...args)
  }

  protected findBinding(key: unknown): { binding: Binding, owner: Container } | undefined {
    for (let c: Container | undefined = this; c; c = c.parent) {
      const binding = c.bindings.get(key)
      if (binding) return { binding, owner: c }
    }
    return undefined
  }

  protected withCycleCheck<T>(key: unknown, fn: () => T): T {
    if (this.resolving.includes(key)) {
      throw new DiError(`Circular dependency: ${[...this.resolving, key].map(keyName).join(' -> ')}`)
    }
    this.resolving.push(key)
    try {
      return fn()
    } finally {
      this.resolving.pop()
    }
  }
}
