import { type InlineConfig } from "vite";
import { Runner } from "./runner/Runner";

export default class Transpile {

  protected config: InlineConfig;
  protected runner?: Runner;

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
    let runner: Runner;
    if(globalThis.__PROD__) {
      const { default: ProductionRunner } = await import('./runner/ProductionRunner')
      runner = new ProductionRunner();
    }
    else {
      const { default: DevRunner } = await import('./runner/DevRunner');
      runner = new DevRunner(this.config);
    }
    this.runner = runner;
    return runner;
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