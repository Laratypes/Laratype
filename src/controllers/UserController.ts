import Controller from "../../core/controller/Controller"
import UserCollection from "../resources/UserCollection"
import User from "../models/User"


export default class UserController extends Controller {

  async store() {
    return User.createMany({
      data: [
        {
          email: "no1.ily1606@gmail.com",
          name: "Test",
          password: "123",
        }
      ]
    })
  }

  async index() {
    const users = await User.findMany({})
    return new UserCollection(users)
  }
}