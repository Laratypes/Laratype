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
 * Which watcher events restart the dev server: any change except the scan's own output, and adding or deleting a
 * file under the contract tree root (a new, deleted or renamed contract or `_scope.ts`).
 */
export const shouldRestart = (event: "change" | "add" | "unlink", file: string, tree: ApiPluginApi | undefined): boolean => {
  if (tree?.isGenerated(file)) return false;
  return event === "change" || (tree?.inTree(file) ?? false);
};
