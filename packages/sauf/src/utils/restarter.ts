import type { ApiPluginApi } from "../typegen/plugin";

/**
 * `sauf dev --hmr` restarts, one after another: a burst of changes never tears down a server that is still booting.
 * The torn-down instance is dropped before `down()` runs, so a failed restart never calls `down()` twice, and the
 * next change starts a fresh instance.
 */
export class DevRestarter<T extends { down(): unknown }> {
  /** The running instance; `undefined` while restarting or after a failed start. */
  public instance: T | undefined;

  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly start: () => Promise<T>,
    private readonly onError: (error: unknown) => void,
  ) {}

  restart(): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        const previous = this.instance;
        this.instance = undefined;
        if (previous) {
          try {
            await previous.down();
          } catch (error) {
            this.onError(error);
          }
        }
        this.instance = await this.start();
      })
      .catch(this.onError);
    return this.queue;
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
