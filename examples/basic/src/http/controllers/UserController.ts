import { Controller } from "@laratype/http";
import CreateUserRequest from "../requests/CreateUserRequest";
import UserCollection from "../resources/UserCollection";
import { User } from "../../models/User";
import { Auth } from "@laratype/auth";


export default class UserController extends Controller {

  async store(request: CreateUserRequest) {
    const params = request.validated();
    return {}
  }

  async index() {
    const users = await User.find();
    return new UserCollection(users)
  }

  async me() {
    const user = Auth.user<User>();
    return user;
  }
}