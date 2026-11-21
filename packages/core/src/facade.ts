import { Container, DiError } from './container'
import type { Token } from './container'
import { depsRegistry } from './registry'

/** Facade application state, on `globalThis` under `Symbol.for` like the deps registry, so two copies of `@laratype/core` agree. */
const STATE = Symbol.for('laratype.di.facade')

interface FacadeState {
  app?: Container
  fallback?: FallbackContainer
  /**
   * The fallback that served before `app` was set, kept until a boot confirms or fails: a failing boot puts it back, so
   * its fakes still apply (D11 #318).
   */
  pending?: FallbackContainer
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
    '[@laratype/core] No app container: facades use a shared autowire-only container, so app bindings do not apply and '
    + 'the singletons it autowires are shared for the process. '
    + 'Call Serve.getContainer() or setFacadeApplication() to use the app container.',
  )
}

/** One swap made while the fallback served as the facade application. */
interface FallbackSwap {
  value: unknown
  /** The binding the swap made here; a later bind replaces it and supersedes the swap. */
  swapped: unknown
  /** The app containers this swap was carried into, with the undo of each copy. */
  carried: Array<{ app: Container, restore: () => void }>
}

/**
 * The shared fallback: an autowire-only container for facades outside an app container. It keeps its active swaps per
 * token (a stack, so nested fakes restore one another), and can replay them into the app container, again after
 * providers registered, or back into itself when a boot fails (D11 #318).
 */
class FallbackContainer extends Container {
  /** Token → its swaps, oldest first: restoring one reinstates the previous. */
  readonly swaps = new Map<unknown, FallbackSwap[]>()

  override swap<T>(token: Token<T>, value: NoInfer<T>): () => void {
    const restore = super.swap(token, value)
    const record: FallbackSwap = { value, swapped: this.bindings.get(token), carried: [] }
    const stack = this.swaps.get(token)
    if (stack) stack.push(record)
    else this.swaps.set(token, [record])
    return () => this.release(token, record, restore)
  }

  /**
   * Replay each token's active swap in `app`, unless the app already binds the token (the app's binding wins). `replace`
   * also puts a fake back over a binding made after its copy (a provider's `register()` or `boot()`), keeping that
   * binding as the fake's restore target.
   */
  carrySwapsTo(app: Container, replace = false): void {
    for (const [token, stack] of this.swaps) {
      const record = stack.at(-1)
      // A bind after the swap supersedes it here, as it makes the swap's restore a no-op
      if (!record || this.bindings.get(token) !== record.swapped) continue
      const copy = record.carried.find(carried => carried.app === app)
      if (!copy) {
        if (app.has(token as Token)) continue
        record.carried.push({ app, restore: app.swap(token as Token, record.value) })
        continue
      }
      if (!replace) continue
      // A provider may have bound over our copy: undo ours first, so the fake's undo restores the provider's binding
      copy.restore()
      copy.restore = app.swap(token as Token, record.value)
    }
  }

  /** Undo one swap: drop its record, then put the previous active one back here and in every app it was carried into. */
  private release(token: unknown, record: FallbackSwap, restore: () => void): void {
    restore()
    const stack = this.swaps.get(token)
    const index = stack?.indexOf(record) ?? -1
    if (!stack || index === -1) return
    stack.splice(index, 1)
    if (stack.length === 0) this.swaps.delete(token)
    const previous = stack.at(-1)
    for (const { app, restore: undo } of record.carried) {
      undo()
      // A restore of an inner fake reinstates the outer one over whatever the app had (a provider binding included)
      if (previous && this.bindings.get(token) === previous.swapped) this.forceCarry(token, previous, app)
    }
  }

  /** Whether a swap is still active: some token's newest record still owns its fallback binding. */
  hasActiveSwaps(): boolean {
    for (const [token, stack] of this.swaps) {
      const record = stack.at(-1)
      if (record && this.bindings.get(token) === record.swapped) return true
    }
    return false
  }

  /** Put `record`'s value in `app` over its current binding, replacing this record's earlier copy there. */
  private forceCarry(token: unknown, record: FallbackSwap, app: Container): void {
    const copy = record.carried.find(carried => carried.app === app)
    if (copy) copy.restore()
    const restore = app.swap(token as Token, record.value)
    if (copy) copy.restore = restore
    else record.carried.push({ app, restore })
  }
}

/**
 * The app container: the one `setFacadeApplication()` set, else one autowire-only container shared by every facade and
 * by the app lookups that move onto it. Creating the fallback warns once per process in dev (D9 #270). http's `Request`
 * fallback switches to this lookup after #379 / #400 merge (D11 #318).
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
   * A fake made while facades used the fallback is carried into `app` (a token the app already binds keeps its binding);
   * `reapplyFakes(app)` then puts it over a provider's binding. Unsetting while an application is set gives the pre-boot
   * fallback back, so a failed boot keeps its fakes. The new container is read before the state changes, so one that
   * throws leaves the state as it was.
   */
  static setFacadeApplication(app: Container | undefined): void {
    const current = state()
    if (app) {
      const fallback = current.fallback ?? current.pending
      // Carry first: a container whose get throws must not leave the facade state half-changed
      if (fallback) fallback.carrySwapsTo(app)
      current.app = app
      current.pending = fallback
      current.fallback = undefined
      return
    }
    const pending = current.pending
    const hadApp = current.app !== undefined
    current.app = undefined
    current.pending = undefined
    // A failed boot puts the fallback that served before it back, with its fakes; a plain unset drops the fallback
    current.fallback = hadApp && pending?.hasActiveSwaps() ? pending : undefined
  }

  /**
   * Boot hook (`bootProviders()`): re-apply the pre-boot fakes over the bindings providers registered or booted, so an
   * explicit fake wins over a provider's implementation (D11 #318).
   */
  static reapplyFakes(app: Container): void {
    const current = state()
    if (current.app !== app || !current.pending) return
    current.pending.carrySwapsTo(app, true)
  }

  /** Boot hook (`bootProviders()`): a successful boot consumes the pre-boot fallback, so a later unset cannot revive it. */
  static confirmFakes(app: Container): void {
    const current = state()
    if (current.app === app) current.pending = undefined
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
