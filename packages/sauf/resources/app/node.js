import { Console } from "@laratype/console";
import { Config, getLaratypeVersion, getRootPackageInfo, importModule, resolveSync } from "@laratype/support";
import { blue, green } from "kolorist";
import { serve } from "@hono/node-server";
import path from "path";

globalThis.__PROD__ = true;
globalThis.__APP_PROD__ = true;

export const start = async () => {
  const startTime = performance.now();

  const laratype = await importModule(resolveSync("laratype"))
  
  await laratype.Serve.bootProvider();

  const app = laratype.Serve.getInstance();
  
  const version = await getLaratypeVersion();
  const rootInfo = await getRootPackageInfo();
  let envFileName = '';
  serve(app, (info) => {
    const endTime = performance.now();
    if (globalThis.__laratype_env_file) {
      envFileName = path.basename(globalThis.__laratype_env_file);
    }
    else {
      Console.warn('No .env file found');
    }

    const messages = [
      green(`Laratype v${version} production server run on:`),
      '',
      green(`Address: ${blue(`${info.address}:${info.port}`)}`),
      green(`Environment: ${blue(Config.get(['env']))}`),
      green(`Env file: ${blue(envFileName)}`),
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
  });
}

start();