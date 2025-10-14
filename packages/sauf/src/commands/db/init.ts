import { importModule } from "@laratype/support";
import { ServiceProviderBootstrapCommand } from "../../utils/mixins";
import { Console } from "@laratype/console";

export default class InitDatabaseCommand extends ServiceProviderBootstrapCommand {
  public static signature = "db:init";

  public static description = "Initialize the database";

  public async handle() {
    let database;
    try {
      database = await importModule("@laratype/database") as typeof import("@laratype/database");
    }
    catch {
      throw new Error("Database package is not installed. Please install it with 'npm install @laratype/database' or 'yarn add @laratype/database'");
    }

    const vite = await this.initViteDevServer();
    
    await this.bootstrapServiceProvider(vite, [
      database.DatabaseServiceProvider
    ]);
    await database.DS.synchronize();
    Console.log("Database initialized successfully.");
    database.DS.destroy();

    vite.close();

    return 0;

  }
}
