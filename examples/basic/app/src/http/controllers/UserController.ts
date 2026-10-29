import { Controller } from "@laratype/http";
import { Auth } from "@laratype/auth";
import CreateUserRequest from "../requests/CreateUserRequest";
import UserCollection from "../resources/UserCollection";
import User from "../../models/User";
import UnauthorizedException from "../../exceptions/UnauthorizedException";


export default class UserController extends Controller {

  async store(request: CreateUserRequest) {
    const params = request.validated();
    const user = await User.save({
      ...params,
      isActive: true,
    });
    return user;
  }

  async index() {
    const users = await User.find();
    return new UserCollection(users)
  }

  async me() {
    const user = Auth.user<User>();
    if(!user) throw new UnauthorizedException({ httpCode: 401, message: "Not signed in." });
    return user.getUser();
  }
}
