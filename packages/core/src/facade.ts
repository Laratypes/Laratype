import { Container, DiError } from './container'
import type { Token } from './container'
import { depsRegistry } from './registry'

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

  private static app: Container | undefined
  private static fallback: Container | undefined

  /** Set the container facades resolve from (the kernel sets the app container); `undefined` unsets it. */
  static setFacadeApplication(app: Container | undefined): void {
    Facade.app = app
  }

  /** The container set by `setFacadeApplication()`, else one autowire-only container shared by every facade. */
  static getFacadeApplication(): Container {
    return Facade.app ?? (Facade.fallback ??= new Container({ deps: depsRegistry }))
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
