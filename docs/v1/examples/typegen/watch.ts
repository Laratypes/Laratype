// docs/v1/typegen.md › Watch mode in sauf dev (G2 #142, merged @ 8ad92ae9).
// A sketch of the wiring in packages/sauf/src/commands/dev.ts, not app code.
import { ContractTypeWatchHost, contractTreePlugin } from 'sauf/src/typegen'
import type { WatchEvents } from 'sauf/src/typegen'

declare const vite: {
  config: { plugins: { name: string; api?: unknown }[] }
  watcher: WatchEvents
}

// the same published plugin `sauf dev` configures; a fresh laratypeApi() would never have scanned
const tree = contractTreePlugin(vite.config.plugins)
const host = new ContractTypeWatchHost()
// a new app instance (first boot, every --hmr restart) replaces the live watch; a burst of events becomes one scan
if (tree) host.open({ events: vite.watcher, tree, onError: (error) => console.error(error) })

export function close() {
  // the laratype:dev-server plugin's closeBundle() calls this when the Vite server closes
  host.close()
}

export async function refresh() {
  // refresh() rescans only after the app has imported $api
  await tree?.refresh()
}
