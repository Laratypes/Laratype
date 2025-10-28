import { Controller, Request } from "@laratype/http";
import { Auth, GateGuard } from "@laratype/auth";
import CreateUserRequest from "../requests/CreateUserRequest";
import UserCollection from "../resources/UserCollection";
import { User } from "../../models/User";
import UpdateUserGate from "../gates/UpdateUserGate";
import UpdateUserRequest from "../requests/UpdateUserRequest";
import UnauthorizedException from "../../exceptions/UnauthorizedException";


export default class UserController extends Controller {

  async store(request: CreateUserRequest) {
    const params = request.validated();
    const user = await User.save(params);
    return user;
  }

  async index() {
    const users = await User.find();
    return new UserCollection(users)
  }

  async me() {
    const user = Auth.user<User>();
    return user;
  }

  async delete(request: Request) {
    const actor = Auth.user<User>();
    const userId = request.param('id');

    const user = await User.findOneOrFail({
      where: {
        id: userId,
      }
    });

    if(actor.cannot('delete', user)) {
      throw new UnauthorizedException();
    }

    return await user.remove();

  }

  async update(request: UpdateUserRequest) {
    console.log(Reflect.getMetadata("policy", User));
    
    const actor = Auth.user<User>();
    const userId = request.param('id');
    const updatedData = request.validated();
    const user = await User.findOneOrFail({
      where: {
        id: userId,
      }
    });

    if(GateGuard.allows(new UpdateUserGate(), actor, user)) {
      // Update user logic here
      return await User.updateFor(user, updatedData);
    }

    throw new UnauthorizedException();
  }
}
