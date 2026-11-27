import { Container, DiError } from './container'
import type { Token } from './container'
import { depsRegistry } from './registry'
import { escapeName } from './names'
import { isProduction } from './runtime'

/** Facade application state, on `globalThis` under `Symbol.for` like the deps registry, so two copies of `@laratype/core` agree. */
const STATE = Symbol.for('laratype.di.facade')

interface FacadeState {
  app?: Container
  fallback?: FallbackContainer
}

const state = (): FacadeState => ((globalThis as { [STATE]?: FacadeState })[STATE] ??= {})

/** Dev warning, once per process: facades use the shared fallback because no app container is set. */
const FALLBACK_WARNED = Symbol.for('laratype.di.fallbackWarned')

/** Dev warning, once per process: an app container replaced the shared fallback with unrestored fakes. */
const FAKES_DROPPED = Symbol.for('laratype.di.fakesDropped')

const warnFallback = (): void => {
  if (isProduction()) return
  const store = globalThis as { [FALLBACK_WARNED]?: true }
  if (store[FALLBACK_WARNED]) return
  store[FALLBACK_WARNED] = true
  console.warn(
    '[@laratype/core] No app container: facades and controllers use a shared autowire-only container, so app bindings do not apply and '
    + 'the singletons it autowires are shared for the process. '
    + 'Call Serve.getContainer() or setFacadeApplication() to use the app container.',
  )
}

/** The most escaped characters a token label echoes: a longer one is cut with an ellipsis. */
const MAX_TOKEN_LABEL = 100

/** A token's label, coerced and escaped: a hostile token cannot make the warning throw, break the line or flood it. */
const tokenLabel = (token: unknown): string => {
  try {
    const name = typeof token === 'function' ? (token as { name?: unknown }).name : token
    const label = name === undefined || name === null || name === '' || (typeof token === 'function' && typeof name !== 'string')
      ? '<anonymous class>'
      : escapeName(String(name))
    return label.length > MAX_TOKEN_LABEL ? `${label.slice(0, MAX_TOKEN_LABEL)}…` : label
  } catch {
    return '<unprintable token>'
  }
}

const warnDroppedFakes = (tokens: ReadonlyArray<unknown>): void => {
  if (isProduction()) return
  const store = globalThis as { [FAKES_DROPPED]?: true }
  if (store[FAKES_DROPPED]) return
  console.warn(
    `[@laratype/core] setFacadeApplication() dropped the shared fallback with unrestored fakes: ${tokens.map(tokenLabel).join(', ')}. `
    + 'Make the fake after the boot (for example in beforeEach after Serve.bootProvider()), or restore it before the boot.',
  )
  // Set after the warning prints, so a warn adapter that throws does not silence the next drop
  store[FAKES_DROPPED] = true
}

/** One swap made while the fallback served as the facade application. */
interface FallbackSwap {
  /** The binding the swap made here; a later bind replaces it and supersedes the swap. */
  swapped: unknown
}

/**
 * The shared fallback: an autowire-only container for facades outside an app container. It tracks its active swaps only
 * to warn when an app container replaces it with fakes still unrestored (D11 #318).
 */
class FallbackContainer extends Container {
  /** Token → its swaps, oldest first; a restore removes its record, so the top is the active one. */
  readonly swaps = new Map<unknown, FallbackSwap[]>()

  override swap<T>(token: Token<T>, value: NoInfer<T>): () => void {
    const restore = super.swap(token, value)
    const record: FallbackSwap = { swapped: this.bindings.get(token) }
    const stack = this.swaps.get(token)
    if (stack) stack.push(record)
    else this.swaps.set(token, [record])
    return () => {
      restore()
      const current = this.swaps.get(token)
      const index = current?.indexOf(record) ?? -1
      if (!current || index === -1) return
      current.splice(index, 1)
      if (current.length === 0) this.swaps.delete(token)
    }
  }

  /** Tokens with an active swap: their newest record still owns this container's binding. */
  activeTokens(): ReadonlyArray<unknown> {
    const tokens: unknown[] = []
    for (const [token, stack] of this.swaps) {
      if (this.bindings.get(token) === stack.at(-1)?.swapped) tokens.push(token)
    }
    return tokens
  }
}

/**
 * The app container: the one `setFacadeApplication()` set, else one autowire-only container shared by every facade and
 * by `ContextApi.getContainer()` / http's `Request.container()`. Creating the fallback warns once per process in dev.
 */
export function appContainer(): Container {
  const current = state()
  if (current.app) return current.app
  if (current.fallback) return current.fallback
  // Store before warning: a warn adapter that resolves a facade re-enters this lookup, and must get this fallback.
  const fallback = new FallbackContainer({ deps: depsRegistry })
  current.fallback = fallback
  warnFallback()
  // Re-read: the warning adapter may have set an app container, which dropped the fallback just created (D11 #318)
  return state().app ?? fallback
}

/** The app container, or the fallback when one was already created: `undefined` instead of allocating it. */
export function peekAppContainer(): Container | undefined {
  const current = state()
  return current.app ?? current.fallback
}

/** What `Facade`'s static helpers need from a facade class: the binding it forwards to. */
export interface FacadeClass<T> {
  readonly accessor: Token<T>
}

/**
 * Static entry point over a container binding, Laravel-style: `Hash.make(value)` resolves `Hash.accessor` from the
 * facade application and calls `make` on it. Subclasses set `accessor` and forward their static methods to `root()`.
 */
export abstract class Facade {
  /** The binding the facade forwards to: a class (autowired when unbound) or a token bound by a provider. */
  declare static readonly accessor: Token<object>

  /**
   * Set the container facades resolve from (the kernel sets the app container); `undefined` unsets it.
   * The fallback is dropped; when it still serves active fakes, one dev warning names them and says to make the fake
   * after the boot or restore it before the boot. The new container is committed without being read, so a proxy whose
   * `get` throws is fine.
   */
  static setFacadeApplication(app: Container | undefined): void {
    const current = state()
    const fallback = current.fallback
    const dropped = app && fallback ? fallback.activeTokens() : []
    current.app = app || undefined
    current.fallback = undefined
    if (dropped.length > 0) warnDroppedFakes(dropped)
  }

  /** Whether `setFacadeApplication()` set a container: false while facades use the fallback container. */
  static hasFacadeApplication(): boolean {
    return state().app !== undefined
  }

  /** The container set by `setFacadeApplication()`, else one autowire-only container shared by every facade. */
  static getFacadeApplication(): Container {
    return appContainer()
  }

  /** Swap the facade's binding for `fake` in the facade application. Returns a function that restores it. */
  static fake<T>(this: FacadeClass<T>, fake: NoInfer<T>): () => void {
    return Facade.getFacadeApplication().swap(accessorOf(this), fake)
  }

  /** The instance the facade forwards to, resolved on every call so a swap takes effect at once. */
  protected static root<T>(this: FacadeClass<T>): T {
    return Facade.getFacadeApplication().make(accessorOf(this))
  }
}

const accessorOf = <T>(facade: FacadeClass<T>): Token<T> => {
  if (facade.accessor === undefined) {
    throw new DiError(`Facade ${(facade as unknown as Function).name || '<anonymous class>'} has no accessor.`)
  }
  return facade.accessor
}
