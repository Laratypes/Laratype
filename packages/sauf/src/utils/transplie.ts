import { createServer, type ViteDevServer, type InlineConfig } from "vite";

export default class Transpile {

  protected config: InlineConfig;
  protected runner?: ViteDevServer;

  constructor(config: InlineConfig) {
    this.config = config;
  }

  public getConfig() {
    return this.config;
  }

  public setConfig(config: InlineConfig) {
    this.config = config;
  }

  public async init() {
    const vite = await createServer(this.config);
    this.runner = vite;
    return vite;
  }

  public async getRunner() {
    if(!this.runner) {
      this.runner = await this.init();
    }
    return this.runner;
  }

  public async close() {
    if(this.runner) {
      await this.runner.close();
      return;
    }
    return;
  }
}