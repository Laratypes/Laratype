import { ServiceProvider } from "@laratype/support";
import { Middleware } from "@laratype/http";
import ProbeMiddleware from "./ProbeMiddleware";

declare global {
  // Filled by the fixture's vite.config.mjs.
  var __ssr_probe_loaded_ids: string[] | undefined;
}

export default class ProbeServiceProvider extends ServiceProvider {
  public boot() {
    const report = {
      constructible: new ProbeMiddleware() instanceof Middleware,
      loaded: globalThis.__ssr_probe_loaded_ids ?? [],
    };
    console.log(`[ssr-probe] ${JSON.stringify(report)}`);
  }
}
