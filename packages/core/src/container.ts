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
  create: (container: Container, requiredBy?: string) => unknown
  resolved?: { value: unknown }
  /** A singleton found to depend on a request-scoped key: cached per request scope from then on. */
  bubbled?: true
}

/** A singleton being built, and the first request-scoped key it was found to depend on. */
interface SingletonFrame {
  requestDep?: unknown
}

/** A request scope's values, keyed by binding (or by class when autowired), in creation order for `dispose()`. */
type RequestCache = Map<unknown, { value: unknown }>

/** The request scope a key resolves in, with its cache. */
interface ResolutionScope {
  scope: Container
  cache: RequestCache
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

/** A name on one line: control and format characters, line separators and backslashes are escaped. */
const escapeName = (name: string): string =>
  name.replace(/[\p{Cc}\p{Cf}\u2028\u2029\\]/gu, (char) => {
    if (char === '\\') return '\\\\'
    const code = char.codePointAt(0)!
    // A supplementary format character escapes as its UTF-16 surrogate pair, so the second unit is not dropped.
    if (code > 0xffff) {
      const offset = code - 0x10000
      return `\\u${(0xd800 + (offset >> 10)).toString(16)}\\u${(0xdc00 + (offset & 0x3ff)).toString(16)}`
    }
    return `\\u${code.toString(16).padStart(4, '0')}`
  })

/** `<C>` for a message: a class name (one line, `<anonymous class>` when unreadable), else `String(key)`. */
const keyName = (key: unknown): string => {
  if (typeof key !== 'function') {
    try {
      return escapeName(String(key))
    } catch {
      return '<unprintable key>'
    }
  }
  try {
    const name = key.name
    return name ? escapeName(typeof name === 'string' ? name : String(name)) : '<anonymous class>'
  } catch {
    return '<anonymous class>'
  }
}

/** `<C> constructor param #<i>`, plus the param name in backticks when the metadata has one. */
const paramLabel = (cls: Function, index: number, name: string | undefined): string =>
  `${keyName(cls)} constructor param #${index}` + (name ? ` \`${name}\`` : '')

/** JavaScript whitespace: space, tab, NBSP, \v, \f, the BOM and U+2028/U+2029 included. */
const isWhitespace = (char: string): boolean => /\s/.test(char)

const isLineTerminator = (char: string): boolean => char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029'

/** Keywords after which a `/` starts a regex literal rather than a division. */
const REGEX_KEYWORDS: ReadonlySet<string> = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'of', 'return', 'typeof', 'void', 'yield',
])

/** Whether the `/` at `index` is in operator position, so it starts a regex literal, not a division. */
const startsRegex = (source: string, index: number): boolean => {
  let previous = index - 1
  while (previous >= 0) {
    const char = source[previous]!
    if (isWhitespace(char)) {
      previous--
      continue
    }
    if (char === '/' && source[previous - 1] === '*') {
      const open = source.lastIndexOf('/*', previous - 2)
      if (open < 0) return true
      previous = open - 1
      continue
    }
    break
  }
  if (previous < 0) return true
  const char = source[previous]!
  // `a++ / b` and `a-- / b`: a postfix operator is followed by a division, not a regex.
  if ((char === '+' || char === '-') && source[previous - 1] === char) return false
  if ('=([{,;:!&|?*>+-/%^~<'.includes(char)) return true
  if (!/[A-Za-z_$]/.test(char)) return false
  let wordStart = previous
  while (wordStart > 0 && /[A-Za-z0-9_$]/.test(source[wordStart - 1]!)) wordStart--
  // `obj.return / 2`: a property name, not the keyword.
  if (wordStart > 0 && source[wordStart - 1] === '.') return false
  return REGEX_KEYWORDS.has(source.slice(wordStart, previous + 1))
}

/** Index after the regex literal at `index`, or `undefined` when it does not close on this line. */
const skipRegex = (source: string, index: number): number | undefined => {
  index++
  let inClass = false
  while (index < source.length) {
    const char = source[index]!
    if (char === '\\') {
      index += 2
    } else if (isLineTerminator(char)) {
      return undefined
    } else if (char === '[') {
      inClass = true
      index++
    } else if (char === ']') {
      inClass = false
      index++
    } else if (char === '/' && !inClass) {
      index++
      while (index < source.length && /[A-Za-z]/.test(source[index]!)) index++
      return index
    } else {
      index++
    }
  }
  return undefined
}

/** Skip whitespace and comments from `index`; returns the next code index. */
const skipTrivia = (source: string, index: number): number => {
  while (index < source.length) {
    const char = source[index]
    if (isWhitespace(char!)) {
      index++
    } else if (char === '/' && source[index + 1] === '/') {
      index += 2
      while (index < source.length && !isLineTerminator(source[index]!)) index++
    } else if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
    } else {
      return index
    }
  }
  return index
}

/** Index after the string or template literal at `index`; `${…}` expressions are scanned too. */
const skipQuoted = (source: string, index: number): number => {
  const quote = source[index]
  index++
  while (index < source.length) {
    const char = source[index]
    if (char === '\\') {
      index += 2
    } else if (char === quote) {
      return index + 1
    } else if (quote === '`' && char === '$' && source[index + 1] === '{') {
      index = skipBalanced(source, index + 1, '{', '}')
    } else {
      index++
    }
  }
  return index
}

/** Index after the `close` that matches the `open` at `index`, skipping strings and comments. */
const skipBalanced = (source: string, index: number, open: string, close: string): number => {
  let depth = 0
  while (index < source.length) {
    const char = source[index]
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(source, index)
    } else if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      index = skipTrivia(source, index)
    } else if (char === '/') {
      if (!startsRegex(source, index)) {
        index++
        continue
      }
      const end = skipRegex(source, index)
      if (end === undefined) return source.length
      index = end
    } else {
      if (char === open) depth++
      else if (char === close && --depth === 0) return index + 1
      index++
    }
  }
  return index
}

/** The raw top-level params between `start` (just after `(`) and `end` (the matching `)`). */
const splitParams = (source: string, start: number, end: number): string[] => {
  const params: string[] = []
  let from = start
  let depth = 0
  let index = start
  while (index < end) {
    const char = source[index]
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(source, index)
    } else if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      index = skipTrivia(source, index)
    } else if (char === '/') {
      if (!startsRegex(source, index)) {
        index++
        continue
      }
      const end = skipRegex(source, index)
      if (end === undefined) break
      index = end
    } else {
      if (char === '(' || char === '[' || char === '{') depth++
      else if (char === ')' || char === ']' || char === '}') depth--
      else if (char === ',' && depth === 0) {
        params.push(source.slice(from, index))
        from = index + 1
      }
      index++
    }
  }
  params.push(source.slice(from, end))
  return params
}

/** Remove comments from a param, so a comment-only slot does not count. */
const stripComments = (param: string): string =>
  param.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n\r\u2028\u2029]*/g, ' ')

/**
 * Non-rest params of the `constructor(...)` a class source starts with, or `undefined` when the source is not a
 * readable class, has no own constructor, or puts a field before it (a known limit). `0` means no params, or a
 * rest-only constructor, which the DI transform treats as no own constructor.
 */
const readLeadingConstructorParamCount = (cls: Function): number | undefined => {
  let source: string
  try {
    source = Function.prototype.toString.call(cls)
  } catch {
    return undefined
  }
  const header = /^\s*class\b[^{]*\{/.exec(source)
  if (!header) return undefined
  let index = skipTrivia(source, header[0].length)
  if (!source.startsWith('constructor', index)) return undefined
  index = skipTrivia(source, index + 'constructor'.length)
  if (source[index] !== '(') return undefined
  const close = skipBalanced(source, index, '(', ')')
  if (source[close - 1] !== ')') {
    // The scan could not parse the list (an ambiguous regex-like literal or an unbalanced source): do not fail open
    // when there is something between the parentheses.
    const rest = stripComments(source.slice(index + 1, Math.min(close, source.length))).trim()
    return rest === '' ? undefined : 1
  }
  const params = splitParams(source, index + 1, close - 1)
    .map((param) => stripComments(param).trim())
    .filter((param) => param !== '')
  return params.filter((param) => !param.startsWith('...')).length
}

/** Per-class cache, `null` for a source that cannot be read: HMR makes a new class object, so it re-reads there. */
const LEADING_PARAM_COUNTS = new WeakMap<Function, number | null>()

const leadingConstructorParamCount = (cls: Function): number | undefined => {
  if (LEADING_PARAM_COUNTS.has(cls)) return LEADING_PARAM_COUNTS.get(cls) ?? undefined
  const count = readLeadingConstructorParamCount(cls) ?? null
  LEADING_PARAM_COUNTS.set(cls, count)
  return count ?? undefined
}

// Same check as the fallback container warning of @laratype/http.
const isProduction = (): boolean => {
  const g = globalThis as { __PROD__?: boolean, process?: { env?: Record<string, string | undefined> } }
  return g.__PROD__ ?? g.process?.env?.NODE_ENV === 'production'
}

/**
 * `Cannot autowire` hints (di.md › Resolution errors with fix hints). Production `sauf build` runs no laratype:di
 * transform yet (B2 #126, B4 #128), so only a factory binding can add the class. In dev both fixes exist, and the
 * factory comes first because the plugin only reaches app code under the Vite root: a class outside the app (a
 * third-party class) can only be bound.
 */
const NO_METADATA_DEV_HINT = ' Fix: bind it with a factory in a service provider `register()` of the app container'
  + ' (the only fix for a class outside the app, such as a third-party class); for app code, the laratype:di plugin compiles it under `sauf dev`.'
const NO_METADATA_PRODUCTION_HINT = ' Fix: bind it with a factory in a service provider `register()` of the app container;'
  + ' a production `sauf build` does not run the laratype:di plugin yet, so it cannot add the metadata.'

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
  noMetadata: (cls: Function, requiredBy?: string, paramCount = cls.length): string =>
    `Cannot autowire ${keyName(cls)}: its constructor takes ${paramCount} param(s) but no dependency metadata was found.`
    + (requiredBy ? ` Required by ${requiredBy}.` : '')
    + (isProduction() ? NO_METADATA_PRODUCTION_HINT : NO_METADATA_DEV_HINT),
  conflict: (param: string, fromTransform: unknown, fromInject: unknown): string =>
    `Conflicting metadata for ${param}: transform says ${keyName(fromTransform)}, @Inject says ${keyName(fromInject)}.`
    + ' Fix: use @Inject from @laratype/core directly (aliases/wrappers are invisible to the build transform).',
  noRequestScope: (key: unknown, requiredBy?: string): string =>
    `Cannot resolve ${keyName(key)}: it is request-scoped but no request scope is active.`
    + (requiredBy ? ` Required by ${requiredBy}.` : '')
    + ' Fix: resolve it inside a request (from the container of `createRequestScope()`), or make it transient.',
  requestScopeDisposed: 'Request scope already disposed.',
}

/** Dev warning, once per key per process: a singleton found to depend on a request-scoped key. */
const bubbleWarning = (key: unknown, requestDep: unknown): string =>
  `[@laratype/core] ${keyName(key)} is a singleton but depends on request-scoped ${keyName(requestDep)}, so it is resolved once per request.`
  + ` Make ${keyName(key)} request-scoped (or transient) to silence this.`

/** Keys already warned about, per process: a second copy of `@laratype/core` shares the set. */
const BUBBLE_WARNED = Symbol.for('laratype.di.bubbleWarned')

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
  protected requestCache: RequestCache | undefined
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
    if (scope.disposed) throw new DiError(errors.requestScopeDisposed)
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
   * A child container for one request: request-scoped values are built once in it, until `dispose()`. It throws under a
   * disposed request scope, or under a plain child of one. A nested request scope made before the disposal is not
   * disposed with it, so it still resolves the keys whose resolution doesn't reach the disposed scope's cache; one that
   * does (a singleton the outer scope builds, that needs a request-scoped key) throws too.
   */
  createRequestScope(options: ContainerOptions = {}): Container {
    if (this.requestScope()?.disposed) throw new DiError(errors.requestScopeDisposed)
    const scope = new Container(options, this)
    scope.requestCache = new Map()
    return scope
  }

  /**
   * End a request scope: drop its request-scoped values and call their `Symbol.asyncDispose` or
   * `Symbol.dispose`, one at a time, newest first. A failing disposer doesn't stop the next one, and the failures
   * are rethrown together as an `AggregateError`; a disposer that never settles leaves the older values undisposed.
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
    // A factory keeps its one-argument signature; only a class target needs the requester for a no-metadata error.
    const create = isFactory(target as Concrete<unknown>)
      ? (container: Container) => (target as Factory<unknown>)(container)
      : (container: Container, requiredBy?: string) => container.build(target as Newable, requiredBy)
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
        return this.fromRequestScope(key, binding, requiredBy, (scope) => scope.withCycleCheck(key, () => binding.create(scope, requiredBy)))
      }
      if (binding.scope === 'singleton') {
        // Built by its owner so a child's overrides never leak into a shared instance.
        const build = () => owner.withCycleCheck(key, () => binding.create(owner, requiredBy))
        if (binding.bubbled) return this.fromRequestScope(key, binding, requiredBy, build)
        const { value, requestDep } = this.buildSingleton(build)
        if (requestDep === undefined) {
          binding.resolved = { value }
          return value
        }
        binding.bubbled = true
        return this.bubble(key, binding, value, requestDep)
      }
      return this.withCycleCheck(key, () => binding.create(this, requiredBy))
    }
    if (typeof key === 'function') {
      // The transform's own-class flag: a concrete subclass of an abstract class still autowires.
      if (isAbstract(key)) throw new DiError(errors.noBindingAbstract(key, requiredBy))
      const scope = injectableScope(key)
      if (scope === 'request') {
        return this.fromRequestScope(key, key, requiredBy, (requestScope) => requestScope.withCycleCheck(key, () => requestScope.build(key as Newable, requiredBy)))
      }
      if (scope === 'singleton') {
        // Built by the root so a child's overrides never leak into the shared instance.
        let root: Container = this
        while (root.parent) root = root.parent
        const build = () => root.withCycleCheck(key, () => root.build(key as Newable, requiredBy))
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
      return this.withCycleCheck(key, () => this.build(key as Newable, requiredBy))
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

  /**
   * The current request scope: this container's, else the one of the `make()` in progress (a singleton's owner sits
   * above it), with its cache. Only request scopes are ever returned.
   */
  protected currentRequestScope(): ResolutionScope | undefined {
    const scope = this.requestScope() ?? this.tree.scopeStack.at(-1)
    const cache = scope?.requestCache
    return scope && cache ? { scope, cache } : undefined
  }

  /**
   * The request scope a request-scoped `key` resolves in, with its cache. A disposed scope is spent: reading or
   * writing its cache would lose the value (nothing disposes what lands after `dispose()`), so it throws like
   * `make()` does.
   */
  protected resolutionScope(key: unknown, requiredBy: string | undefined): ResolutionScope {
    const current = this.currentRequestScope()
    if (!current) throw new DiError(errors.noRequestScope(key, requiredBy))
    if (current.scope.disposed) throw new DiError(errors.requestScopeDisposed)
    return current
  }

  /** The value of a request-scoped `key`, built once per request scope and cached there under `cacheKey`. */
  protected fromRequestScope(
    key: unknown,
    cacheKey: unknown,
    requiredBy: string | undefined,
    create: (scope: Container) => unknown,
  ): unknown {
    const { scope, cache } = this.resolutionScope(key, requiredBy)
    // Every singleton being built depends on this key, directly or not, so it bubbles.
    for (const frame of this.tree.singletons) frame.requestDep ??= key
    const cached = cache.get(cacheKey)
    if (cached) return cached.value
    const value = create(scope)
    // A factory that starts the disposal while it builds: the cache was cleared, so the value must not land in it
    if (scope.disposed) throw new DiError(errors.requestScopeDisposed)
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
    this.resolutionScope(key, undefined).cache.set(cacheKey, { value })
    return value
  }

  /** Construct `cls`, resolving its constructor params from the deps lookup and `@Inject` records. */
  protected build(cls: Newable, requiredBy?: string): unknown {
    const entry = this.deps.get(cls)
    // An inherited entry with no slots does not cover a constructor whose defaults hide its params. Only a lookup
    // that implements `hasOwn` can say an entry is inherited; without it, the entry it returned is authoritative.
    const hiddenParams = entry !== undefined
      && entry.slots.length === 0
      && cls.length === 0
      && this.deps.hasOwn?.(cls) === false
    if (!entry || hiddenParams) {
      // `cls.length` is 0 when every param has a default; the source tells those apart from a no-arg constructor.
      const params = leadingConstructorParamCount(cls) ?? cls.length
      if (params > 0) throw new DiError(errors.noMetadata(cls, requiredBy, params))
      if (!entry) return new cls()
    }
    const injected = injectTokens(cls)
    const args: unknown[] = []
    // A loop, not `map`: one less frame per level keeps a deep autowire chain off the call stack limit.
    for (let index = 0; index < entry.slots.length; index++) {
      const slot = entry.slots[index]
      const optional = entry.meta?.optional?.includes(index) ?? false
      const param = paramLabel(cls, index, entry.meta?.params[index])
      const override = injected?.get(index)
      if (typeof slot !== 'function') {
        if (override !== undefined) {
          args.push(this.resolve(override, param))
        } else if (optional) {
          args.push(undefined)
        } else {
          throw new DiError(errors.unresolvedParam(param, slot.unresolved))
        }
        continue
      }
      const dep = slot()
      if (override !== undefined) {
        if (dep !== undefined && dep !== override) {
          throw new DiError(errors.conflict(param, dep, override))
        }
        args.push(this.resolve(override, param))
        continue
      }
      if (dep === undefined) {
        if (optional) {
          args.push(undefined)
          continue
        }
        throw new DiError(errors.undefinedThunk(param))
      }
      args.push(this.resolve(dep, param))
    }
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
