import { Controller } from "@laratype/http";
import CreateUserRequest from "../requests/CreateUserRequest";
import UserCollection from "../resources/UserCollection";
import { User } from "../../models/User";


export default class UserController extends Controller {

  async store(request: CreateUserRequest) {
    const params = request.validated();
    return {}
  }

  async index() {
    const users = await User.find();
    return new UserCollection(users)
  }
}