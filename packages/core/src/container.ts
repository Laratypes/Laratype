import { noDeps } from './deps'
import type { DepsLookup } from './deps'
import { InjectionToken } from './token'
import { injectableScope, injectTokens } from './decorators'
import { isAbstract } from './registry'

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

/** `<C> constructor param #<i>`, plus the param name in backticks when the metadata has one. */
const paramLabel = (cls: Function, index: number, name: string | undefined): string =>
  `${keyName(cls)} constructor param #${index}` + (name ? ` \`${name}\`` : '')

/** `DiError` messages with fix hints (D5a). The first sentence of each is the D1 base message. */
const errors = {
  noBinding: (key: unknown, requiredBy?: string): string =>
    `No binding for ${keyName(key)}.`
    + (requiredBy ? ` Required by ${requiredBy}.` : '')
    + ' Fix: bind it in a service provider `register()`, e.g. `container.bind(token, factory)` or `container.instance(token, value)`.',
  noBindingAbstract: (cls: Function, requiredBy?: string): string =>
    `No binding for abstract class ${keyName(cls)}.`
    + (requiredBy ? ` Required by ${requiredBy}.` : '')
    + ` Fix: bind it to a concrete class in a service provider \`register()\`, e.g. \`container.bind(${keyName(cls)}, Impl)\`.`,
  unresolvedParam: (param: string, typeText: string): string =>
    `Cannot resolve ${param}: type \`${typeText}\` has no runtime value.`
    + ' Fix: add @Inject(token) to the parameter, or import the class as a value (not `import type`).',
  undefinedThunk: (param: string): string =>
    `Cannot resolve ${param}: its type resolved to undefined at runtime.`
    + ' It is probably an interface/type imported without `import type`, or a circular import evaluated too early.'
    + ' Fix: use `import type` + @Inject(token), or import the class as a value.',
  noMetadata: (cls: Function): string =>
    `Cannot autowire ${keyName(cls)}: its constructor takes ${cls.length} param(s) but no dependency metadata was found.`
    + ' Fix: compile the class with the laratype:di plugin (app code under sauf dev), or bind it with a factory in a service provider `register()` of the app container.',
  conflict: (param: string, fromTransform: unknown, fromInject: unknown): string =>
    `Conflicting metadata for ${param}: transform says ${keyName(fromTransform)}, @Inject says ${keyName(fromInject)}.`
    + ' Fix: use @Inject from @laratype/core directly (aliases/wrappers are invisible to the build transform).',
}

const isFactory = (concrete: Concrete<unknown>): concrete is Factory<unknown> =>
  concrete.prototype === undefined

export class Container {
  protected readonly bindings = new Map<unknown, Binding>()
  protected readonly parent: Container | undefined
  protected readonly deps: DepsLookup
  /** Keys currently being built, shared by the whole container tree (circular dependency detection). */
  protected readonly resolving: unknown[]
  /** Unbound classes autowired as `@Injectable({ scope: 'singleton' })`, cached on the root container. */
  protected readonly autowired = new Map<unknown, { value: unknown }>()

  constructor(options: ContainerOptions = {}, parent?: Container) {
    this.parent = parent
    this.deps = options.deps ?? parent?.deps ?? noDeps
    this.resolving = parent?.resolving ?? []
  }

  /**
   * Bind `token` to a class or factory. Without `scope`, a class bound uses its `@Injectable({ scope })`,
   * else transient. Omit `concrete` to bind a class to itself.
   */
  bind<T>(token: Newable<T>, concrete?: undefined, options?: BindOptions): this
  bind<T>(token: Token<T>, concrete: NoInfer<Concrete<T>>, options?: BindOptions): this
  bind(token: Token, concrete?: Concrete<unknown>, options: BindOptions = {}): this {
    const target = concrete ?? token
    const scope = options.scope ?? (typeof target === 'function' ? injectableScope(target) : undefined)
    return this.register(token, concrete, scope ?? 'transient')
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

  /**
   * Bind `token` to `value` in this container, for tests. Returns a function that puts back this container's own
   * previous binding of `token` (or none); call the restore functions in reverse order.
   */
  swap<T>(token: Token<T>, value: NoInfer<T>): () => void {
    const previous = this.bindings.get(token)
    this.instance(token, value)
    return () => {
      if (previous) this.bindings.set(token, previous)
      else this.bindings.delete(token)
    }
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

  /** `requiredBy` names the constructor param that asked for `key`, for the error message. */
  protected resolve(key: unknown, requiredBy?: string): unknown {
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
      // The transform's own-class flag: a concrete subclass of an abstract class still autowires.
      if (isAbstract(key)) throw new DiError(errors.noBindingAbstract(key, requiredBy))
      if (injectableScope(key) === 'singleton') {
        // Built by the root so a child's overrides never leak into the shared instance.
        let root: Container = this
        while (root.parent) root = root.parent
        const cached = root.autowired.get(key)
        if (cached) return cached.value
        const value = root.withCycleCheck(key, () => root.build(key as Newable))
        root.autowired.set(key, { value })
        return value
      }
      return this.withCycleCheck(key, () => this.build(key as Newable))
    }
    throw new DiError(errors.noBinding(key, requiredBy))
  }

  /** Construct `cls`, resolving its constructor params from the deps lookup and `@Inject` records. */
  protected build(cls: Newable): unknown {
    const entry = this.deps.get(cls)
    if (!entry) {
      if (cls.length > 0) throw new DiError(errors.noMetadata(cls))
      return new cls()
    }
    const injected = injectTokens(cls)
    const args = entry.slots.map((slot, index) => {
      const optional = entry.meta?.optional?.includes(index) ?? false
      const param = paramLabel(cls, index, entry.meta?.params[index])
      const override = injected?.get(index)
      if (typeof slot !== 'function') {
        if (override !== undefined) return this.resolve(override, param)
        if (optional) return undefined
        throw new DiError(errors.unresolvedParam(param, slot.unresolved))
      }
      const dep = slot()
      if (override !== undefined) {
        if (dep !== undefined && dep !== override) {
          throw new DiError(errors.conflict(param, dep, override))
        }
        return this.resolve(override, param)
      }
      if (dep === undefined) {
        if (optional) return undefined
        throw new DiError(errors.undefinedThunk(param))
      }
      return this.resolve(dep, param)
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
