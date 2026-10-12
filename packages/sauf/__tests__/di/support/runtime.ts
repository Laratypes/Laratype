/**
 * Test stub for `virtual:laratype/di`, shaped like D2 (#97): the registry is a hidden, configurable own
 * property under `Symbol.for('laratype.di.deps')`, `__laratype_deps(Cls, slots, meta?)` returns `Cls`, and
 * lookup uses the own entry first, walking to the parent only when there is none.
 * The container is a minimal stand-in for D2/D3 so fixtures can resolve graphs; swap this module for
 * `@laratype/core`'s DI runtime once it lands (only `runtimeSource` in `pipeline.ts` points here).
 */
type Ctor = abstract new (...args: any[]) => any;
type Token = Ctor | symbol | string;

export interface UnresolvedSlot {
  unresolved: string;
  index: number;
}
export type Slot = (() => unknown) | UnresolvedSlot;

export interface DepsMeta {
  params: string[];
  optional?: number[];
}

export interface DepsEntry {
  slots: Slot[];
  meta?: DepsMeta;
}

export const DEPS_KEY = Symbol.for('laratype.di.deps');

const injectOverrides = new WeakMap<Function, Map<number, Token>>();

const ownEntry = (cls: Function): DepsEntry | undefined =>
  Object.prototype.hasOwnProperty.call(cls, DEPS_KEY) ? (cls as any)[DEPS_KEY] : undefined;

/** Emitted by the transform after each class with an own constructor. Returns the class (for wrapped expressions). */
export function __laratype_deps<T extends Function>(cls: T, slots: Slot[], meta?: DepsMeta): T {
  Object.defineProperty(cls, DEPS_KEY, { value: { slots, meta }, configurable: true, enumerable: false, writable: false });
  return cls;
}

/**
 * Own entry first; only when the class has no own entry walk to the parent
 * (a class without an own constructor inherits the parent's signature).
 */
export function getDeps(cls: Function): { owner: Function; entry: DepsEntry } | undefined {
  for (let c: any = cls; typeof c === 'function' && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    const entry = ownEntry(c);
    if (entry) return { owner: c, entry };
  }
  return undefined;
}

export function hasOwnDeps(cls: Function): boolean {
  return ownEntry(cls) !== undefined;
}

/** `@Inject(token)`: kept as a runtime record only to detect disagreement with the transform. */
export function Inject(token: Token) {
  return (target: any, _key: string | symbol | undefined, index: number) => {
    const cls = typeof target === 'function' ? target : target.constructor;
    let map = injectOverrides.get(cls);
    if (!map) injectOverrides.set(cls, (map = new Map()));
    map.set(index, token);
  };
}

export function Injectable(_options: { scope?: 'singleton' | 'transient' } = {}) {
  return (_target: Function) => {};
}

export class DiError extends Error {
  override name = 'DiError';
}

const tokenName = (t: unknown) =>
  typeof t === 'function' ? t.name || '<anonymous class>' : String(t);

export class Container {
  protected bindings = new Map<Token, unknown>();
  protected instances = new Map<Token, unknown>();

  bind(token: Token, value: unknown): this {
    this.bindings.set(token, value);
    return this;
  }

  resolve<T>(token: Token, path: Token[] = []): T {
    if (this.bindings.has(token)) return this.bindings.get(token) as T;
    if (this.instances.has(token)) return this.instances.get(token) as T;
    if (typeof token !== 'function') throw new DiError(`No binding for token ${tokenName(token)}`);
    if (path.includes(token)) {
      throw new DiError(`Circular dependency: ${[...path, token].map(tokenName).join(' -> ')}`);
    }
    const args = this.resolveArgs(token, [...path, token]);
    const instance = new (token as any)(...args);
    this.instances.set(token, instance);
    return instance;
  }

  protected resolveArgs(cls: Function, path: Token[]): unknown[] {
    const found = getDeps(cls);
    if (!found) return []; // no metadata anywhere in the chain -> zero-arg
    const { owner, entry } = found;
    const overrides = injectOverrides.get(owner);
    return entry.slots.map((slot, index) => {
      const param = `${cls.name || '<anonymous class>'} constructor param #${index} \`${entry.meta?.params[index] ?? '?'}\``;
      const override = overrides?.get(index);
      const optional = entry.meta?.optional?.includes(index) ?? false;

      if (typeof slot !== 'function') {
        // Unresolved marker: legal only if a decorator the transform did not recognise supplied a token.
        if (override !== undefined) return this.resolve(override, path);
        if (optional) return undefined;
        throw new DiError(
          `Cannot resolve ${param}: type \`${slot.unresolved}\` has no runtime value. `
          + `Fix: add @Inject(token) to the parameter, or import the class as a value (not \`import type\`).`,
        );
      }

      const dep = slot();
      if (override !== undefined && override !== dep) {
        throw new DiError(
          `Conflicting metadata for ${param}: transform says ${tokenName(dep)}, @Inject says ${tokenName(override)}. `
          + `Fix: use @Inject from @laratype directly (aliases/wrappers are invisible to the build transform).`,
        );
      }
      if (dep === undefined) {
        if (optional) return undefined;
        throw new DiError(
          `Cannot resolve ${param}: its type resolved to undefined at runtime. `
          + `It is probably an interface/type imported without \`import type\`, or a circular import evaluated too early. `
          + `Fix: use \`import type\` + @Inject(token), or import the class as a value.`,
        );
      }
      return this.resolve(dep as Token, path);
    });
  }
}

/** Tiny assert helpers so fixtures don't depend on @types/node. */
export function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`Assertion failed: ${message} (got ${String(actual)}, expected ${String(expected)})`);
}

export function assertThrows(fn: () => unknown, pattern: RegExp, message: string): void {
  try {
    fn();
  } catch (e: any) {
    if (!pattern.test(String(e?.message))) throw new Error(`Assertion failed: ${message}: wrong error "${e?.message}"`);
    return;
  }
  throw new Error(`Assertion failed: ${message}: did not throw`);
}
