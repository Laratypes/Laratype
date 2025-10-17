import { Config, resolveSync, getLaratypeVersion, getRootPackageInfo, type Hono } from "@laratype/support";
import { type ViteDevServer } from "vite";
import { Console } from "@laratype/console";
import { green, blue } from "kolorist";
import path from "path";
import { IncomingMessage, ServerResponse } from "http";
import { getRequestListener } from "@hono/node-server";
import { ServiceProviderBootstrapCommand } from "../utils/mixins";

export default class LaratypeDevCommand extends ServiceProviderBootstrapCommand {

  static signature = 'dev'

  static description = 'Start the development server'

  static options = [
    ['-p, --port <port>', 'Port to run the server on', '3000'],
    ['-H, --host <host>', 'Host to run the server on', 'localhost'],
  ]

  protected viteDevServer: ViteDevServer | undefined;

  protected async appStart(vite: ViteDevServer): Promise<Hono> {
    const { Serve } = await vite.ssrLoadModule(resolveSync("laratype")) as typeof import("laratype");

    await Serve.bootProvider(vite)

    return Serve.getInstance();

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

  protected async createMiddleware(app: any, server: ViteDevServer) {

    return async (
      req: IncomingMessage,
      res: ServerResponse,
      next: (err?: any) => void
    ) => {
      await this.requestHandler({ app, server, req, res, next });
    }
  }

  public async handle() {

    Console.start('Starting Laratype application...');

    const commander = this.getCommander();
    const opts = commander.opts();

    this.setViteConfig({
      server: {
        port: opts.port,
        host: opts.host,
        hmr: false,
      },
      plugins: [
        {
          name: 'laratype:dev-server',
          configureServer: async (server) => {
            let app = await this.appStart(server);

            // Waiting to Implement HRM
            // server.watcher.on('change', (async () => {
            //   app = await this.appStart(server);
            // }));

            server.middlewares.use(await this.createMiddleware(app, server));
          }
        },
      ]
    });

    const startTime = performance.now();

    const vite = await this.initViteDevServer();

    await vite.listen();

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
      green(`HMR: ${blue("False")}`),
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
  }
}