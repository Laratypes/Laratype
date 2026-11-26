import { Seeder } from "@laratype/database";
import UserSeeder from "./UserSeeder";

export default class DatabaseSeeder extends Seeder {
  public async run() {
    await this.call([
      UserSeeder
    ])
  }
}