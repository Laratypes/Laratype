// docs/v1/typegen.md › Watch mode in sauf dev (G2 #142, proposed).
// The watch belongs to `sauf dev`, not to app code: this is the wiring in packages/sauf/src/commands/dev.ts.
import { ContractTypeWatchHost, laratypeApi } from 'sauf/src/typegen'
import type { ApiPluginApi, WatchEvents } from 'sauf/src/typegen'

const plugin = laratypeApi()
const tree = plugin.api as ApiPluginApi
declare const watcher: WatchEvents

const host = new ContractTypeWatchHost()
// the first boot and every --hmr restart replace the live watch; a burst of add/unlink events becomes one scan
host.open({ events: watcher, tree, delay: 30, onError: (error) => console.error(error) })

export function close() {
  // the Vite server's closeBundle() calls this
  host.close()
}

export async function refresh() {
  // rescans when the app has imported $api; a no-op before that
  await tree.refresh()
}
