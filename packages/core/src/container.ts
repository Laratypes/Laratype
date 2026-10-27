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

/** `request`: once per request scope (`createRequestScope()`), disposed with it. */
export type Scope = 'transient' | 'request' | 'singleton'

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
  /** A singleton found to depend on a request-scoped key: cached per request scope from then on. */
  bubbled?: true
}

/** A singleton being built, and the first request-scoped key it was found to depend on. */
interface SingletonFrame {
  requestDep?: unknown
}

/** State shared by a whole container tree. */
interface TreeState {
  /** Keys currently being built (circular dependency detection). */
  resolving: unknown[]
  /** Singletons currently being built, so a request-scoped dep bubbles to all of them. */
  singletons: SingletonFrame[]
  /** Request scopes of the `make()` calls in progress: a singleton's owner builds it outside its request scope. */
  scopeStack: Container[]
}

const asyncDisposeKey: symbol = (Symbol as { asyncDispose?: symbol }).asyncDispose ?? Symbol.for('Symbol.asyncDispose')
const disposeKey: symbol = (Symbol as { dispose?: symbol }).dispose ?? Symbol.for('Symbol.dispose')

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
  noRequestScope: (key: unknown, requiredBy?: string): string =>
    `Cannot resolve ${keyName(key)}: it is request-scoped but no request scope is active.`
    + (requiredBy ? ` Required by ${requiredBy}.` : '')
    + ' Fix: resolve it inside a request (from the container of `createRequestScope()`), or make it transient.',
}

/** Dev warning, once per key per process: a singleton found to depend on a request-scoped key. */
const bubbleWarning = (key: unknown, requestDep: unknown): string =>
  `[@laratype/core] ${keyName(key)} is a singleton but depends on request-scoped ${keyName(requestDep)}, so it is resolved once per request.`
  + ` Make ${keyName(key)} request-scoped (or transient) to silence this.`

/** Keys already warned about, per process: a second copy of `@laratype/core` shares the set. */
const BUBBLE_WARNED = Symbol.for('laratype.di.bubbleWarned')

// Same check as the fallback container warning of @laratype/http.
const isProduction = (): boolean => {
  const g = globalThis as { __PROD__?: boolean, process?: { env?: Record<string, string | undefined> } }
  return g.__PROD__ ?? g.process?.env?.NODE_ENV === 'production'
}

const warnBubbled = (key: unknown, requestDep: unknown): void => {
  if (isProduction()) return
  const store = globalThis as { [BUBBLE_WARNED]?: Set<unknown> }
  const warned = store[BUBBLE_WARNED] ??= new Set()
  if (warned.has(key)) return
  warned.add(key)
  console.warn(bubbleWarning(key, requestDep))
}

const isFactory = (concrete: Concrete<unknown>): concrete is Factory<unknown> =>
  concrete.prototype === undefined

export class Container {
  protected readonly bindings = new Map<unknown, Binding>()
  protected readonly parent: Container | undefined
  protected readonly deps: DepsLookup
  protected readonly tree: TreeState
  /** Unbound classes autowired as `@Injectable({ scope: 'singleton' })`, cached on the root container. */
  protected readonly autowired = new Map<unknown, { value: unknown }>()
  /** Autowired singleton classes found to depend on a request-scoped key, on the root container. */
  protected readonly bubbled = new Set<unknown>()
  /**
   * Set on a request scope only: its request-scoped values, keyed by binding (or by class when autowired),
   * in creation order for `dispose()`.
   */
  protected requestCache: Map<unknown, { value: unknown }> | undefined
  protected disposed = false

  constructor(options: ContainerOptions = {}, parent?: Container) {
    this.parent = parent
    this.deps = options.deps ?? parent?.deps ?? noDeps
    this.tree = parent?.tree ?? { resolving: [], singletons: [], scopeStack: [] }
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

  /** Bind `token` once per request scope: the first `make()` result in a request is reused until it ends. */
  scoped<T>(token: Newable<T>): this
  scoped<T>(token: Token<T>, concrete: NoInfer<Concrete<T>>): this
  scoped(token: Token, concrete?: Concrete<unknown>): this {
    return this.register(token, concrete, 'request')
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
   * previous binding of `token` (or none), unless `token` was bound again since; call the restore functions in reverse order.
   */
  swap<T>(token: Token<T>, value: NoInfer<T>): () => void {
    const previous = this.bindings.get(token)
    this.instance(token, value)
    const swapped = this.bindings.get(token)
    return () => {
      if (this.bindings.get(token) !== swapped) return
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
    const scope = this.requestScope()
    if (!scope) return this.resolve(token) as T
    if (scope.disposed) throw new DiError('Request scope already disposed.')
    // Resolution is synchronous, so concurrent requests never interleave on this stack.
    this.tree.scopeStack.push(scope)
    try {
      return this.resolve(token) as T
    } finally {
      this.tree.scopeStack.pop()
    }
  }

  /** New container that sees this container's bindings; its own bindings shadow them without affecting this one. */
  createChild(options: ContainerOptions = {}): Container {
    return new Container(options, this)
  }

  /**
   * A child container for one request: request-scoped values are built once in it, until `dispose()`.
   * A disposed request scope, or a child of one, throws instead.
   */
  createRequestScope(options: ContainerOptions = {}): Container {
    if (this.requestScope()?.disposed) throw new DiError('Request scope already disposed.')
    const scope = new Container(options, this)
    scope.requestCache = new Map()
    return scope
  }

  /**
   * End a request scope: drop its request-scoped values and call their `Symbol.asyncDispose` or
   * `Symbol.dispose`, newest first. Failures are rethrown together as an `AggregateError` once all ran.
   */
  async dispose(): Promise<void> {
    if (!this.requestCache) throw new DiError('Only a request scope can be disposed.')
    if (this.disposed) return
    this.disposed = true
    // A value cached under two keys (a factory that returns another request-scoped value) is disposed once, at the
    // place it was first built, so the values built after it from it are still disposed before it
    const values = [...new Set([...this.requestCache.values()].map(({ value }) => value))].reverse()
    this.requestCache.clear()
    const failures: unknown[] = []
    for (const value of values) {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) continue
      const target = value as Record<symbol, unknown>
      try {
        if (typeof target[asyncDisposeKey] === 'function') await (target[asyncDisposeKey] as () => unknown).call(value)
        else if (typeof target[disposeKey] === 'function') (target[disposeKey] as () => unknown).call(value)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, `Failed to dispose ${failures.length} request-scoped value(s).`)
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
      if (binding.scope === 'request') {
        // Built by the request scope, so its own bindings (per-request values) apply.
        return this.fromRequestScope(key, binding, requiredBy, (scope) => scope.withCycleCheck(key, () => binding.create(scope)))
      }
      if (binding.scope === 'singleton') {
        // Built by its owner so a child's overrides never leak into a shared instance.
        const build = () => owner.withCycleCheck(key, () => binding.create(owner))
        if (binding.bubbled) return this.fromRequestScope(key, binding, requiredBy, build)
        const { value, requestDep } = this.buildSingleton(build)
        if (requestDep === undefined) {
          binding.resolved = { value }
          return value
        }
        binding.bubbled = true
        return this.bubble(key, binding, value, requestDep)
      }
      return this.withCycleCheck(key, () => binding.create(this))
    }
    if (typeof key === 'function') {
      // The transform's own-class flag: a concrete subclass of an abstract class still autowires.
      if (isAbstract(key)) throw new DiError(errors.noBindingAbstract(key, requiredBy))
      const scope = injectableScope(key)
      if (scope === 'request') {
        return this.fromRequestScope(key, key, requiredBy, (requestScope) => requestScope.withCycleCheck(key, () => requestScope.build(key as Newable)))
      }
      if (scope === 'singleton') {
        // Built by the root so a child's overrides never leak into the shared instance.
        let root: Container = this
        while (root.parent) root = root.parent
        const build = () => root.withCycleCheck(key, () => root.build(key as Newable))
        if (root.bubbled.has(key)) return this.fromRequestScope(key, key, requiredBy, build)
        const cached = root.autowired.get(key)
        if (cached) return cached.value
        const { value, requestDep } = this.buildSingleton(build)
        if (requestDep === undefined) {
          root.autowired.set(key, { value })
          return value
        }
        root.bubbled.add(key)
        return this.bubble(key, key, value, requestDep)
      }
      return this.withCycleCheck(key, () => this.build(key as Newable))
    }
    throw new DiError(errors.noBinding(key, requiredBy))
  }

  /** The nearest request scope: this container or an ancestor. */
  protected requestScope(): Container | undefined {
    for (let c: Container | undefined = this; c; c = c.parent) {
      if (c.requestCache) return c
    }
    return undefined
  }

  /** The current request scope: this container's, else the one of the `make()` in progress (a singleton's owner sits above it). */
  protected currentRequestScope(): Container | undefined {
    return this.requestScope() ?? this.tree.scopeStack.at(-1)
  }

  /** The value of a request-scoped `key`, built once per request scope and cached there under `cacheKey`. */
  protected fromRequestScope(
    key: unknown,
    cacheKey: unknown,
    requiredBy: string | undefined,
    create: (scope: Container) => unknown,
  ): unknown {
    const scope = this.currentRequestScope()
    if (!scope) throw new DiError(errors.noRequestScope(key, requiredBy))
    // Every singleton being built depends on this key, directly or not, so it bubbles.
    for (const frame of this.tree.singletons) frame.requestDep ??= key
    const cache = scope.requestCache!
    const cached = cache.get(cacheKey)
    if (cached) return cached.value
    const value = create(scope)
    cache.set(cacheKey, { value })
    return value
  }

  /** Build a singleton, recording the first request-scoped key it depends on, directly or not. */
  protected buildSingleton(build: () => unknown): { value: unknown, requestDep: unknown } {
    const frame: SingletonFrame = {}
    this.tree.singletons.push(frame)
    try {
      return { value: build(), requestDep: frame.requestDep }
    } finally {
      this.tree.singletons.pop()
    }
  }

  /** Cache the first value of a bubbled singleton in the current request scope, and warn once in dev. */
  protected bubble(key: unknown, cacheKey: unknown, value: unknown, requestDep: unknown): unknown {
    warnBubbled(key, requestDep)
    this.currentRequestScope()!.requestCache!.set(cacheKey, { value })
    return value
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
    const { resolving } = this.tree
    if (resolving.includes(key)) {
      throw new DiError(`Circular dependency: ${[...resolving, key].map(keyName).join(' -> ')}`)
    }
    resolving.push(key)
    try {
      return fn()
    } finally {
      resolving.pop()
    }
  }
}
