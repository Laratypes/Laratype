import { AppServiceProvider, importModule, ServiceProvider, ServiceProviderType } from "@laratype/support";
import { Command, Console } from "@laratype/console";

export default class InitDatabaseCommand extends Command {
  public static signature = "db:init";

  public static description = "Initialize the database";

  protected database: any;

  public async providers(providers: Array<typeof AppServiceProvider | typeof ServiceProvider>) {
    try {
      this.database = await importModule("@laratype/database") as typeof import("@laratype/database");
    }
    catch {
      throw new Error("Database package is not installed. Please install it with 'npm install @laratype/database' or 'yarn add @laratype/database'");
    }
    return [
      ...providers.filter((provider) => provider.type === ServiceProviderType.CORE_PROVIDER),
      this.database.DatabaseServiceProvider,
    ]
  }

  public async handle() {
    const database = this.database as typeof import("@laratype/database");
    await database.DS.synchronize();
    Console.success("Database initialized successfully.");

    return 0;

  }
}
