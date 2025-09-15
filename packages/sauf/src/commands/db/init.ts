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
    
    await this.bootstrapServiceProvider([
      database.DatabaseServiceProvider
    ]);
    await database.DS.synchronize();
    Console.log("Database initialized successfully.");
    database.DS.destroy();

    return 0;

  }
}
