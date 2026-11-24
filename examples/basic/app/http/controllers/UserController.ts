import { errors } from "@laratype/contract";
import { Controller } from "@laratype/http";
import type { ControllerOf, Ctx } from "@laratype/http";
import meContract from "../../api/me";
import usersContract from "../../api/users";
import { toUserProfile } from "../../api/_schemas";
import type User from "../../models/User";
import { parseRouteId } from "../../services/routeId";
import UserService from "../../services/UserService";

// Constructor DI without a decorator: `laratype:di` records `UserService` as this class's dependency.
export default class UserController extends Controller implements ControllerOf<typeof usersContract> {

  constructor(private readonly userService: UserService) {
    super();
  }

  public index() {
    return { data: this.userService.all() };
  }

  public show({ params }: Ctx<typeof usersContract.show>) {
    const id = parseRouteId(params.id);
    const user = id === null ? undefined : this.userService.find(id);
    if (!user) throw errors.notFound();
    return user;
  }

  public store({ body }: Ctx<typeof usersContract.store>) {
    return this.userService.create(body);
  }

  public me({ user }: Ctx<typeof meContract.me, { user: User }>) {
    return toUserProfile(user);
  }
}
