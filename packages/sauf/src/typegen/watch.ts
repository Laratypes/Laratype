import type { ApiPluginApi } from "./plugin";

/**
 * The type watch of `sauf dev` (G2 #142): Vite's watcher events for the contract tree, debounced into one
 * `laratype:api` refresh per burst, without a server restart. The scan itself is G1's name-only `syncContractTree`,
 * so a generation writes only the files whose content changed.
 */

const EVENTS = ["add", "change", "unlink"] as const;

type WatchEvent = (typeof EVENTS)[number];

/** The watcher methods the type watch needs: Vite's `server.watcher` (chokidar) in `sauf dev`, a stub in tests. */
export interface WatchEvents {
  on(event: WatchEvent, listener: (file: string) => void): unknown;
  off(event: WatchEvent, listener: (file: string) => void): unknown;
}

/** The `laratype:api` part the type watch reads: which events can change the tree, and how to refresh it. */
type TreeSource = Pick<ApiPluginApi, "affectsTree" | "isGenerated" | "refresh">;

/** Options of {@link ContractTypeWatch}. */
export interface ContractTypeWatchOptions {
  /** The file watcher: Vite's `server.watcher` in `sauf dev`. */
  readonly events: WatchEvents;
  /** The `laratype:api` plugin API: which events can change the tree, and `refresh()`. */
  readonly tree: TreeSource;
  /** Debounce after the last relevant event before one scan, in ms. Default 30; finite and 0 or more. */
  readonly delay?: number;
  /** Receives a failed scan (a `ScanError` prefixed `[laratype:api]`). Default `console.error`. */
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_DELAY = 30;

const checkDelay = (delay: number | undefined): number => {
  if (delay === undefined) return DEFAULT_DELAY;
  if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0) {
    throw new TypeError(`the type watch delay must be a finite number of milliseconds, 0 or more, got ${String(delay)}`);
  }
  return delay;
};

/**
 * Watches the [contract folder tree](../../../../docs/v1/contract.md#contract-folder-tree) and refreshes the generated
 * files without restarting the app: an add or delete of a contract or `_scope.ts`, or a config change, is debounced
 * into one `refresh()`; a failed scan is reported and the last good output stays. Events on the generated output and
 * outside the tree are ignored, so the watch's own writes never loop.
 */
export class ContractTypeWatch {
  private readonly delay: number;

  private readonly onError: (error: unknown) => void;

  private readonly events: WatchEvents;

  private readonly tree: TreeSource;

  private readonly listeners: Record<WatchEvent, (file: string) => void>;

  private timer: ReturnType<typeof setTimeout> | undefined;

  private running: Promise<void> | undefined;

  private requested = false;

  private disposed = false;

  private readonly waiters: (() => void)[] = [];

  constructor(options: ContractTypeWatchOptions) {
    if (options === null || typeof options !== "object") throw new TypeError("the type watch needs an options object");
    const { events, tree, onError } = options;
    if (typeof events?.on !== "function" || typeof events.off !== "function") {
      throw new TypeError("the type watch events must provide on() and off()");
    }
    if (
      !tree ||
      typeof tree.affectsTree !== "function" ||
      typeof tree.isGenerated !== "function" ||
      typeof tree.refresh !== "function"
    ) {
      throw new TypeError("the type watch tree needs affectsTree(), isGenerated() and refresh()");
    }
    if (onError !== undefined && typeof onError !== "function") {
      throw new TypeError("the type watch onError must be a function");
    }
    this.delay = checkDelay(options.delay);
    this.onError = onError ?? ((error) => console.error(error));
    this.events = events;
    this.tree = tree;
    this.listeners = {
      add: (file) => this.onEvent("add", file),
      change: (file) => this.onEvent("change", file),
      unlink: (file) => this.onEvent("unlink", file),
    };
    for (const event of EVENTS) events.on(event, this.listeners[event]);
  }

  private onEvent(event: WatchEvent, file: string): void {
    if (this.disposed || this.tree.isGenerated(file)) return;
    if (!this.tree.affectsTree(event, file)) return;
    this.request();
  }

  /** A relevant event: debounce, then one scan; an event during a scan queues exactly one more scan. */
  private request(): void {
    if (this.disposed) return;
    this.requested = true;
    if (this.timer || this.running) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.drain().finally(() => {
        this.running = undefined;
        this.settle();
      });
    }, this.delay);
  }

  private async drain(): Promise<void> {
    while (this.requested && !this.disposed) {
      this.requested = false;
      try {
        await this.tree.refresh();
      } catch (error) {
        this.onError(error);
      }
    }
  }

  /** Resolves when no debounce or scan is pending, so tests and a restart can await the watch instead of sleeping. */
  idle(): Promise<void> {
    if (!this.timer && !this.running) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private settle(): void {
    if (this.timer || this.running) return;
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  /** Stops listening and drops a pending debounce; an in-flight scan still finishes (the plugin serializes scans). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const event of EVENTS) this.events.off(event, this.listeners[event]);
    this.requested = false;
    this.settle();
  }
}

/**
 * The one live type watch of an app instance. `sauf dev` opens a new watch on every boot and `--hmr` restart, which
 * disposes the previous one first, and closes it when the Vite server closes, so listeners and timers never stack.
 */
export class ContractTypeWatchHost {
  private current: ContractTypeWatch | undefined;

  /** Whether a watch is live. */
  get active(): boolean {
    return this.current !== undefined;
  }

  /** Replaces the live watch: the new watch is built first, so bad options leave the live one untouched. */
  open(options: ContractTypeWatchOptions): ContractTypeWatch {
    const next = new ContractTypeWatch(options);
    this.close();
    this.current = next;
    return next;
  }

  /** Disposes the live watch, if any. Safe to call twice. */
  close(): void {
    this.current?.dispose();
    this.current = undefined;
  }

  /** Resolves when the live watch, if any, has no debounce or scan pending. */
  idle(): Promise<void> {
    return this.current?.idle() ?? Promise.resolve();
  }
}
