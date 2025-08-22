import { resolveSync } from "@laratype/support";
import { createServer, ViteDevServer } from "vite";
import { Command } from "@laratype/console";

export default class LaratypeDevCommand extends Command {

  static signature = 'dev'

  static description = 'Start the development server'

  protected options = [
    ['-p, --port <port>', 'Port to run the server on', '3000'],
    ['-H, --host <host>', 'Host to run the server on', 'localhost'],
  ]

  protected viteDevServer: ViteDevServer | undefined;

  protected async appStart(vite: ViteDevServer) {
    const commander = this.getCommander();
    const opts = commander.opts();

    const { Serve } = await vite.ssrLoadModule(resolveSync("laratype")) as typeof import("laratype");

    const app = Serve.create(opts.port, opts.host)

    return app;
  }

  public async getViteDevServer() {
    // Initialize Vite development server
    return this.viteDevServer ??= await createServer({
      appType: 'custom',
    })
  }

  public async handle() {

    console.log('Starting Laratype application...');

    const vite = await this.getViteDevServer();

    await this.appStart(vite)
  }
}