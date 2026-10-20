import { AppServiceProvider, loadDefault, manifestEntry, ServiceProvider, ServiceProviderType } from "@laratype/support";
import { Command, Console } from "@laratype/console";

export default class SeedDatabaseCommand extends Command {
  public static signature = "db:seed";

  public static description = "Seed the database";

  public static options = [
    ['--class <class>', 'Class to run seed'],
  ]

  protected database: any;

  public async providers(providers: Array<typeof AppServiceProvider | typeof ServiceProvider>) {
    try {
      this.database = await globalThis.__sauf_transpiler_instance("@laratype/database", {
        internal: true
      }) as typeof import("@laratype/database");
    }
    catch {
      throw new Error("Database package is not installed. Please install it with 'npm install @laratype/database' or 'yarn add @laratype/database'");
    }
    return [
      ...providers.filter((provider) => provider.type === ServiceProviderType.CORE_PROVIDER),
      this.database.DatabaseServiceProvider,
    ]
  }

  protected async getSeeders() {
    const opts = this.opts();
    const className = opts.class;
    // The seeder files of the app manifest (docs/v1/build.md › Plugin chain)
    const name = className ?? 'DatabaseSeeder';
    const entry = manifestEntry('seeders', name);
    if(!entry) {
      Console.error(`Seeder class ${name} not found in the seeders folder (app/database/seeders or database/seeders)`);
      return [];
    }

    return [
      await loadDefault<any>(entry)
    ];
  }

  public async handle() {

    await new Promise((resolve) => {
      setTimeout(resolve, 5000)
    })
    const Seeders = await this.getSeeders();
    
    for (const Seeder of Seeders) {
      const seeder = new Seeder();
      Console.start(`Seeding: ${seeder.constructor.name}...`);
      await seeder.run();
      Console.success(`Seeded: ${seeder.constructor.name}`);
    }

    return 0;

  }
}
