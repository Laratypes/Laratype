import { Factory, UseModel } from "@laratype/database"
import { faker } from "@faker-js/faker"
import Post from "../../app/models/Post"

@UseModel(Post)
export default class PostFactory extends Factory<Post> {
  definition () {
    return this.createDefinition({
      content: faker.lorem.paragraphs(3),
    })
  }
}