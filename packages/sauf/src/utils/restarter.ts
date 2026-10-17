import type { ApiPluginApi } from "../typegen/plugin";

/**
 * `sauf dev --hmr` restarts, coalesced: while a restart runs, any number of new events queue exactly one more, so a
 * burst of changes (an editor's add + change) never tears down a server that is still booting.
 * The torn-down instance is dropped before `down()` runs, so a failed restart never calls `down()` twice, and the
 * next change starts a fresh instance.
 */
export class DevRestarter<T extends { down(): unknown }> {
  /** The running instance; `undefined` while restarting or after a failed start. */
  public instance: T | undefined;

  private running: Promise<void> | undefined;

  private dirty = false;

  constructor(
    private readonly start: () => Promise<T>,
    private readonly onError: (error: unknown) => void,
  ) {}

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
      this.instance = await this.start();
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
