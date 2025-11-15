import { Factory, UseModel } from "@laratype/database"
import { faker } from "@faker-js/faker"
import { Hash } from "@laratype/support"
import User from "../../src/models/User"

@UseModel(User)
export default class UserFactory extends Factory<User> {
  definition () {
    return this.createDefinition({
      email: faker.internet.email(),
      password: Hash.make("password"),
      age: faker.number.int({ min: 18, max: 80 }),
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      isActive: true,
    })
  }
}