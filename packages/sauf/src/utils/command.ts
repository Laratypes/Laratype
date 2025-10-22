import { Command as Commander } from 'commander'
import { Command as CommandInstance } from '@laratype/console';
import Transpile from './transplie';
import { resolveSync } from '@laratype/support';
import SignatureNotConfigYet from '../exceptions/SignatureNotConfigYet';

export default class Command {
  protected signature: string;
  
  protected description: string;

  protected commander: Commander|undefined;

  protected options: string[][] | undefined;

  protected argument: string | undefined;

  protected commandInstance: typeof CommandInstance;

  protected transpiler: Transpile;

  constructor(commandInstance: typeof CommandInstance, transpiler: Transpile) {
    this.commandInstance = commandInstance;
    if(!commandInstance.signature) {
      throw new SignatureNotConfigYet();
    }
    this.transpiler = transpiler;
    this.signature = commandInstance.signature;
    this.description = commandInstance.description;
    this.options = commandInstance.options;
    this.argument = commandInstance.argument;
    this.__initCommander();
  }

  protected __initCommander() {

    const commander = this.getCommander(); 

    commander
      .description(this.description);

    this.options?.forEach(options => {
      const [flags, description, defaultValue] = options;
      commander.option(flags, description, defaultValue);
    });

    if (this.argument) {
      commander.argument(this.argument);
    }

    commander.action(async (...args) => {
      const instance = new this.commandInstance();
      instance.opts = commander.opts.bind(commander);
      await instance.boot.call(instance, this.transpiler);
      const vite = await this.transpiler.getRunner()
      const laratype = await vite.ssrLoadModule(resolveSync("laratype")) as typeof import("laratype");
      const serviceProviders = await laratype.register();

      const filteredProviders = await instance.providers(serviceProviders);
      const serverInstance = laratype.Serve.getInstance();

      const downs = [];
      for(let Provider of filteredProviders) {
        const providerInstance = new Provider(vite as any, serverInstance);
        const handler = providerInstance.boot();
        if(handler instanceof Promise) {
          await handler;
        }
        downs.push(providerInstance.down.bind(providerInstance));
      }
      downs.reverse();
      const exitCode = await instance.handle.call(instance, ...args);
      
      downs.forEach(down => {
        down();
      });

      await this.transpiler.close();

      return exitCode;
    })

  }

  public getCommander() {
    return this.commander ??= new Commander(this.signature);
  }
}