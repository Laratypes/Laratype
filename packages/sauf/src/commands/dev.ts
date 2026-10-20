import { Config, getLaratypeVersion, getRootPackageInfo, type Hono, resolveModule } from "@laratype/support";
import { type InlineConfig, type ViteDevServer } from "vite";
import { Command, Console } from "@laratype/console";
import { green, blue } from "kolorist";
import path from "path";
import { IncomingMessage, ServerResponse } from "http";
import { getRequestListener } from "@hono/node-server";
import Transpile from "../utils/transplie";
import type { Runner } from "../utils/runner/Runner";
import { contractTreePlugin } from "../typegen/plugin";
import { DevRestarter, RescanFlag, shouldRestart } from "../utils/restarter";
import { useAppManifest } from "../manifest/load";
import { isManifestFile } from "../manifest/scan";

export default class LaratypeDevCommand extends Command {

  static signature = 'dev'

  static description = 'Start the development server'

  static options = [
    ['-p, --port <port>', 'Port to run the server on', '3000'],
    ['-H, --host <host>', 'Host to run the server on', 'localhost'],
    ['--hmr', 'Enable Hot Module Replacement'],
  ]

  // Disable all providers by default
  public async providers() {
    return [];
  }

  protected runner: Runner | undefined;

  protected server: DevRestarter<{ app: Hono, down: () => void }> | undefined;

  /** Set by a watcher event that can change the contract tree; the next (re)start rescans it. */
  protected rescan = new RescanFlag();

  public async boot(transpiler: Transpile) {
    Console.start('Starting Laratype application...');

    const opts = this.opts();
    
    await transpiler.close();
    const oldConfig = transpiler.getConfig();
    const devServerConfig: InlineConfig = {
      server: {
        port: opts.port,
        host: opts.host,
        hmr: false,
      },
      plugins: [
        {
          name: 'laratype:dev-server',
          configureServer: async (server) => {
            const restarter = new DevRestarter(() => this.appStart(server), (error) => Console.error(error));
            this.server = restarter;
            await restarter.start();

            if(opts.hmr) {
              const tree = contractTreePlugin(server.config.plugins);
              for (const event of ['change', 'add', 'unlink'] as const) {
                server.watcher.on(event, (file: string) => {
                  // The scan rewrites its output folder during a restart: that must not trigger another one
                  // A file added to or deleted from a manifest folder: laratype:manifest invalidated the list
                  if (!shouldRestart(event, file, tree, (f) => isManifestFile(process.cwd(), f))) return;
                  // Only a file added or deleted under the root, or the config, can change the tree
                  if (tree?.affectsTree(event, file)) this.rescan.mark();
                  Console.info('File change detected. Restarting server...');
                  void restarter.restart();
                });
              }
            }

            server.middlewares.use(await this.createMiddleware(server));
          }
        },
      ]
    };

    const { mergeConfig } = await import(resolveModule("vite", {
      url: import.meta.url,
    })) as typeof import("vite");

    const newConfig = mergeConfig(oldConfig, devServerConfig);
    transpiler.setConfig(newConfig);

    await transpiler.init();

    this.runner = await transpiler.getRunner();

    await this.runner.ready();
    
  }

  protected async appStart(vite: ViteDevServer): Promise<{ app: Hono, down: () => void }> {
    globalThis.__sauf_transpiler_instance = vite.ssrLoadModule.bind(this.runner);

    // Rescan the contract tree before a restart when it can have changed (the first `$api` import scans it)
    const tree = contractTreePlugin(vite.config.plugins);
    await this.rescan.run(tree && (() => tree.restart()));

    // Loaded again on each (re)start: a file added to or deleted from a manifest folder invalidated it
    await useAppManifest((id) => vite.ssrLoadModule(id));

    const { Serve } = await vite.ssrLoadModule(resolveModule("laratype", {
      internal: true,
    })) as typeof import("laratype");

    const cleanupFns = await Serve.bootProvider();

    // Every cleanup runs and the Hono app and container are reset even when one throws (Serve.stop)
    const down = () => Serve.stop(cleanupFns);

    return {
      app: Serve.getInstance(),
      down,
    }

  }

  protected async requestHandler({ app, server, req, res }: any) {
    //  app.use((context: unknown, next: any) => {
    //   // if (err instanceof Error)
    //   //   server.ssrFixStacktrace(err);

    //   next(context);
    // });

    const requestListener = getRequestListener(app.fetch);

    requestListener(req, res);

  }

  protected async createMiddleware(server: ViteDevServer) {

    return async (
      req: IncomingMessage,
      res: ServerResponse,
      next: (err?: any) => void
    ) => {
      const instance = this.server?.current;
      if (!instance) {
        // Restarting, or the last restart failed (its error is printed): the next change retries
        res.statusCode = 503;
        res.end('Laratype dev server is restarting or failed to start; see the terminal.');
        return;
      }
      await this.requestHandler({ app: instance.app, server, req, res, next });
    }
  }

  public async handle() {

    const opts = this.opts();
    const startTime = globalThis.__sauf_start_time || performance.now();

    const runner = this.runner!;

    await runner.listen();

    const endTime = performance.now();

    const version = await getLaratypeVersion();
    const rootInfo = await getRootPackageInfo();
    
    let envFileName = '';

    if (globalThis.__laratype_env_file) {
      envFileName = path.basename(globalThis.__laratype_env_file);
    }
    else {
      Console.warn('No .env file found');
    }

    const messages = [
      green(`Laratype v${version} dev server run on:`),
      '',
      green(`Address: ${blue(`http://${opts.host}:${opts.port}`)}`),
      green(`Environment: ${blue(Config.get(['env']))}`),
      green(`Env file: ${blue(envFileName)}`),
      green(`HMR: ${blue(opts.hmr ? "True" : "False")}`),
      '',
      green(`Ready in ${blue(`${(endTime - startTime).toFixed(2)}ms`)}`),
    ]

    Console.box({
      title: `${rootInfo.name ?? ''} ${rootInfo.version ?? ''}`,
      message: messages.join('\n'),
      style: {
      padding: 2,
        borderColor: "cyan",
      },
    });

    await new Promise(() => {}); // Keep the server running
  }
}