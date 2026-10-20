import { AppServiceProvider, loadDefault, manifestEntry, ServiceProvider, ServiceProviderType } from "@laratype/support";
import { Command, Console } from "@laratype/console";
import { importDatabase } from "./database";

export default class SeedDatabaseCommand extends Command {
  public static signature = "db:seed";

  public static description = "Seed the database";

  public static options = [
    ['--class <class>', 'Class to run seed'],
  ]

  protected database: any;

  public async providers(providers: Array<typeof AppServiceProvider | typeof ServiceProvider>) {
    // As db:init does: `__sauf_transpiler_instance` is not set in the built `dist/cli.js`
    this.database = await importDatabase();
    return [
      ...providers.filter((provider) => provider.type === ServiceProviderType.CORE_PROVIDER),
      this.database.DatabaseServiceProvider,
    ]
  }

  /**
   * The seeder classes to run: `--class <name>` (its path in the seeders folder, `Admin/UserSeeder`), or
   * `DatabaseSeeder`. `undefined` when the app manifest has no such seeder (the error is printed).
   */
  public async getSeeders(): Promise<Array<new () => { run(): unknown }> | undefined> {
    const opts = this.opts();
    // The seeder files of the app manifest (docs/v1/build.md › Plugin chain)
    const name: string = opts.class ?? 'DatabaseSeeder';
    const entry = manifestEntry('seeders', name);
    if(!entry) {
      Console.error(`Seeder class ${name} not found in the seeders folder (app/database/seeders or database/seeders)`);
      return undefined;
    }

    return [
      await loadDefault<new () => { run(): unknown }>(entry)
    ];
  }

  public async handle() {
    // Before the wait for the connection: an unknown seeder fails at once
    const Seeders = await this.getSeeders();
    if(!Seeders) {
      process.exitCode = 1;
      return 1;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 5000)
    })

    for (const Seeder of Seeders) {
      const seeder = new Seeder();
      Console.start(`Seeding: ${seeder.constructor.name}...`);
      await seeder.run();
      Console.success(`Seeded: ${seeder.constructor.name}`);
    }

    return 0;

  }
}
