import { Config, resolveSync, getLaratypeVersion, getRootPackageInfo } from "@laratype/support";
import { createServer, createLogger , type ViteDevServer } from "vite";
import { Command, Console } from "@laratype/console";
import { green, blue } from "kolorist";
import path from "path";

const logger = createLogger()
const loggerWarn = logger.warn

logger.warn = (msg, options) => {
  if (msg.includes('vite:import-analysis') && msg.includes(' /* @vite-ignore */')) return
  loggerWarn(msg, options)
}

export default class LaratypeDevCommand extends Command {

  static signature = 'dev'

  static description = 'Start the development server'

  static options = [
    ['-p, --port <port>', 'Port to run the server on', '3000'],
    ['-H, --host <host>', 'Host to run the server on', 'localhost'],
  ]

  protected viteDevServer: ViteDevServer | undefined;

  protected async appStart(vite: ViteDevServer) {
    const commander = this.getCommander();
    const opts = commander.opts();

    const { Serve } = await vite.ssrLoadModule(resolveSync("laratype")) as typeof import("@laratype/laratype");

    const app = await Serve.create(opts.port, opts.host)

    return app;
  }

  public async getViteDevServer() {
    // Initialize Vite development server
    return this.viteDevServer ??= await createServer({
      appType: 'custom',
      customLogger: logger
    })
  }

  public async handle() {

    Console.start('Starting Laratype application...');

    const vite = await this.getViteDevServer();
    const startTime = performance.now();

    await this.appStart(vite)

    const endTime = performance.now();

    const version = await getLaratypeVersion();
    const rootInfo = await getRootPackageInfo();
    
    const commander = this.getCommander();
    const opts = commander.opts();
    const envFileName = path.basename((globalThis as any).__laratype_env_file) ?? '';

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