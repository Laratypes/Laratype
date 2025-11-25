import { type InlineConfig, ViteDevServer, createServer } from "vite";
import { Runner } from "./Runner";

export default class DevRunner implements Runner {
  private vite: Promise<ViteDevServer>;
  private config: InlineConfig;

  constructor(config: InlineConfig) {
    this.config = config;
    this.vite = createServer(this.config);
  }

  async ready() {
    return await this.vite
  }

  ssrLoadModule(modulePath: string, opts?: any): Promise<any> {
    return this.vite.then(vite => {
      return vite.ssrLoadModule(modulePath, opts);
    });
  }

  close(): Promise<void> {
    return this.vite.then(vite => vite.close());
  }

  async listen(): Promise<void> {
    const vite = await this.vite;
    await vite.listen();
  }
}