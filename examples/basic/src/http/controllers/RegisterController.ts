import { Controller } from "@laratype/http";
import CreateUserRequest from "../requests/CreateUserRequest";
import User from "../../models/User";

export default class RegisterController extends Controller {

  async register(request: CreateUserRequest) {

    const user = await User.save(request.validated());

    return user;
  }

  
}