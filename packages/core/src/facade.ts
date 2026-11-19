import { Container, DiError } from './container'
import type { Token } from './container'
import { depsRegistry } from './registry'

/** Facade application state, on `globalThis` under `Symbol.for` like the deps registry, so two copies of `@laratype/core` agree. */
const STATE = Symbol.for('laratype.di.facade')

interface FacadeState {
  app?: Container
  fallback?: FallbackContainer
}

const state = (): FacadeState => ((globalThis as { [STATE]?: FacadeState })[STATE] ??= {})

/** Dev warning, once per process: an app lookup created the shared autowire-only fallback. */
const FALLBACK_WARNED = Symbol.for('laratype.di.fallbackWarned')

/** Same dev-only check as the container's request-scope bubble warning. */
const isProduction = (): boolean => {
  const g = globalThis as { __PROD__?: boolean, process?: { env?: Record<string, string | undefined> } }
  return g.__PROD__ ?? g.process?.env?.NODE_ENV === 'production'
}

const warnFallback = (): void => {
  if (isProduction()) return
  const store = globalThis as { [FALLBACK_WARNED]?: true }
  if (store[FALLBACK_WARNED]) return
  store[FALLBACK_WARNED] = true
  console.warn(
    '[@laratype/core] No app container: facades and app lookups outside a request use a shared autowire-only container, '
    + 'so app bindings do not apply and the singletons it autowires are shared for the process. '
    + 'Call Serve.getContainer() or setFacadeApplication() to use the app container.',
  )
}

/**
 * The shared fallback: an autowire-only container for facades and app lookups outside a booted app. It remembers its
 * active swaps, so `setFacadeApplication()` carries a `Hash.fake()` made before the boot into the app container (D11 #318).
 */
class FallbackContainer extends Container {
  /** Token → the value of each swap, the binding it made, and the undos of the copies carried into an app container. */
  readonly swaps = new Map<unknown, { value: unknown, swapped: unknown, carried: Array<() => void> }>()

  override swap<T>(token: Token<T>, value: NoInfer<T>): () => void {
    const restore = super.swap(token, value)
    const record = { value, swapped: this.bindings.get(token), carried: [] as Array<() => void> }
    this.swaps.set(token, record)
    return () => {
      restore()
      if (this.swaps.get(token) !== record) return
      this.swaps.delete(token)
      // A swap carried into the app container is undone there too, unless that container rebound the token since
      for (const undo of record.carried) undo()
    }
  }

  /** Replay the active swaps in `app`, unless it already binds the token: the app container's own binding wins. */
  carrySwapsTo(app: Container): void {
    for (const [token, record] of this.swaps) {
      // A bind after the swap supersedes it here, as it makes the swap's restore a no-op
      if (this.bindings.get(token) !== record.swapped) continue
      if (app.has(token as Token)) continue
      record.carried.push(app.swap(token as Token, record.value))
    }
  }
}

/**
 * The app container: the one `setFacadeApplication()` set, else one autowire-only container shared by every facade and
 * app lookup. Creating the fallback warns once per process in dev (D9 #270). http's `Request` fallback switches to this
 * lookup after #379 / #400 merge (D11 #318).
 */
export function appContainer(): Container {
  const current = state()
  if (current.app) return current.app
  if (current.fallback) return current.fallback
  warnFallback()
  return (current.fallback = new FallbackContainer({ deps: depsRegistry }))
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
   * A swap made while facades used the fallback (a `Hash.fake()` before boot) is carried into `app`, so it survives the
   * boot; either way the fallback container is dropped, so its autowired instances do not outlive the app.
   */
  static setFacadeApplication(app: Container | undefined): void {
    const current = state()
    const fallback = current.fallback
    current.app = app ?? undefined
    current.fallback = undefined
    if (app && fallback) fallback.carrySwapsTo(app)
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
