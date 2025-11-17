import { Seeder } from "@laratype/database";
import User from "../../src/models/User";
import UserFactory from "../factories/UserFactory";
import PostFactory from "../factories/PostFactory";
import Post from "../../src/models/Post";

export default class UserSeeder extends Seeder {
  public async run(): Promise<void> {
    const users = await UserFactory.make<User>().state((attributes) => {
      return {
        isActive: false,
      }
    }).count(10).has<Post>(PostFactory.make<Post>().count(3), 'posts').create()
    
  }
}