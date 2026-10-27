import { errors } from "@laratype/contract";
import { Controller } from "@laratype/http";
import type { ControllerOf, Ctx } from "@laratype/http";
import usersContract from "../../../../api/users";
import UserService from "../../../services/UserService";

// Constructor DI without a decorator: `laratype:di` records `UserService` as this class's dependency.
export default class UserController extends Controller implements ControllerOf<typeof usersContract> {

  constructor(private readonly userService: UserService) {
    super();
  }

  public index() {
    return { data: this.userService.all() };
  }

  public show({ params }: Ctx<typeof usersContract.show>) {
    const user = this.userService.find(Number(params.id));
    if (!user) throw errors.notFound();
    return user;
  }

  public store({ body }: Ctx<typeof usersContract.store>) {
    return this.userService.create(body);
  }
}
