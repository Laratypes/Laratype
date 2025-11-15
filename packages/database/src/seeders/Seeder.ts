
export default abstract class Seeder {

  public async call(seeders: Array<new () => Seeder>) {
    for (const SeederClass of seeders) {
      const seeder = new SeederClass();
      await seeder.run();
    }
  }

  abstract run(): Promise<void>;
}
