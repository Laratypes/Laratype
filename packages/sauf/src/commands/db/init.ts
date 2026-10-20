import { ServiceProviderType } from "@laratype/support";
import type { AppServiceProvider, ServiceProvider } from "@laratype/support";
import { Command, Console } from "@laratype/console";
import { importDatabase } from "./database";

export default class InitDatabaseCommand extends Command {
  public static signature = "db:init";

  public static description = "Initialize the database";

  protected database: any;

  public async providers(providers: Array<typeof AppServiceProvider | typeof ServiceProvider>) {
    this.database = await importDatabase();
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
