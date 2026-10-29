/**
 * The named drivers of a service, by the config key that names each one: `{ single: Logger, stack: Logger }`
 * (docs/v1/services.md › Driver Manager).
 */
export type DriverMap = Record<string, object>

/**
 * Shared base of the driver-based services (cache, queue, mail, storage, broadcast, log): `driver(name?)` resolves
 * the driver a config key names, builds it once and caches it per name, and `extend()` replaces its factory.
 *
 * @example
 * class LogManager extends Manager<Record<'single' | 'stack', Logger>, 'single'> {
 *   protected override get defaultDriver() { return config('logging.default') }
 *   protected override createDriver(name: 'single' | 'stack') { ... }
 * }
 */
export abstract class Manager<
  Drivers extends DriverMap = DriverMap,
  Default extends keyof Drivers & string = keyof Drivers & string,
> {
  /** Drivers built so far, by name: the per-name instance cache. */
  private readonly instances = new Map<keyof Drivers & string, Drivers[keyof Drivers]>()
  /** Factories added by `extend()`, by name; they win over `createDriver()`. */
  private readonly factories = new Map<keyof Drivers & string, (manager: this) => Drivers[keyof Drivers]>()

  /** The name `driver()` resolves when called without one: the `default` key of the service's config file. */
  protected abstract get defaultDriver(): Default

  /** Builds the driver named `name` from the service config. Throw for a name the service does not support. */
  protected abstract createDriver(name: keyof Drivers & string): Drivers[keyof Drivers]

  /** The driver named `name` (the default driver when omitted), built once and cached by name. */
  driver<K extends keyof Drivers & string = Default>(name?: K): Drivers[K] {
    const key = name ?? this.defaultDriver
    const cached = this.instances.get(key)
    // The map is keyed by name, so `key` holds `Drivers[K]`; TypeScript cannot correlate a dynamic key with K.
    if (cached !== undefined) return cached as Drivers[K]
    const factory = this.factories.get(key)
    const driver = factory ? factory(this) : this.createDriver(key)
    this.instances.set(key, driver)
    return driver as Drivers[K]
  }

  /**
   * Replaces the factory of the driver named `name`, a name the service config declares, and drops its cached
   * instance so the next `driver(name)` call uses `factory` (docs/v1/services.md › Driver Manager).
   */
  extend<K extends keyof Drivers & string>(name: K, factory: (manager: this) => Drivers[K]): this {
    this.factories.set(name, factory)
    this.instances.delete(name)
    return this
  }
}
