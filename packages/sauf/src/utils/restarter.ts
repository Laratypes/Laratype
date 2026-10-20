import type { ApiPluginApi } from "../typegen/plugin";

/**
 * The `sauf dev` server instance and its `--hmr` restarts.
 * - `start()` does the first boot and rethrows, so a broken app fails `sauf dev` as before.
 * - `restart()` is coalesced: while a restart runs, any number of new events queue exactly one more, so a burst of
 *   changes (an editor's add + change) never tears down a server that is still booting.
 * - The running instance is dropped before its `down()` runs, so `down()` is never called twice. A failed boot leaves
 *   no instance; `boot` itself must release what it booted (`Serve.bootProvider()` runs the providers' `down()` and
 *   resets the Hono app and container), and the next event boots a fresh instance.
 */
export class DevRestarter<T extends { down(): unknown }> {
  private instance: T | undefined;

  private running: Promise<void> | undefined;

  private dirty = false;

  constructor(
    private readonly boot: () => Promise<T>,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** The running instance; `undefined` while restarting or after a failed restart. */
  get current(): T | undefined {
    return this.instance;
  }

  /** The first boot. Rethrows. */
  async start(): Promise<void> {
    this.instance = await this.boot();
  }

  /** Resolves when no restart is pending any more. */
  restart(): Promise<void> {
    if (this.running) {
      this.dirty = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.dirty = false;
        await this.once();
      } while (this.dirty);
      this.running = undefined;
    })();
    return this.running;
  }

  private async once() {
    const previous = this.instance;
    this.instance = undefined;
    if (previous) {
      try {
        await previous.down();
      } catch (error) {
        this.onError(error);
      }
    }
    try {
      this.instance = await this.boot();
    } catch (error) {
      this.onError(error);
    }
  }
}

/**
 * "The contract tree may have changed": set by a watcher event, cleared only once a rescan succeeded, so a failed
 * rescan is retried on the next restart.
 */
export class RescanFlag {
  private pending = false;

  get isPending(): boolean {
    return this.pending;
  }

  mark(): void {
    this.pending = true;
  }

  /**
   * Runs `rescan` when pending. The flag is cleared before it runs, so a `mark()` during the rescan (a file added
   * while the config is imported) makes the next run rescan again, and set again if it throws.
   */
  async run(rescan: (() => Promise<void>) | undefined): Promise<void> {
    if (!this.pending) return;
    this.pending = false;
    try {
      await rescan?.();
    } catch (error) {
      this.pending = true;
      throw error;
    }
  }
}

/**
 * Which watcher events restart the dev server: any change except the scan's own output, and adding or deleting a
 * file that can change the contract tree (a contract or `_scope.ts` under the root, or the config file) or the app
 * manifest (`inManifest`: a module file in one of its folders, so the restart boots with the new list).
 */
export const shouldRestart = (
  event: "change" | "add" | "unlink",
  file: string,
  tree: ApiPluginApi | undefined,
  inManifest: (file: string) => boolean = () => false,
): boolean => {
  if (tree?.isGenerated(file)) return false;
  return event === "change" || (tree?.affectsTree(event, file) ?? false) || inManifest(file);
};
