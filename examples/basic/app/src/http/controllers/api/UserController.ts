import { errors } from "@laratype/contract";
import { Controller } from "@laratype/http";
import type { ControllerOf, Ctx } from "@laratype/http";
import usersContract from "../../../../api/users";
import UserService from "../../../services/UserService";

// The ids `UserService` creates are `[1-9]\d*`: `Number()` alone would read `0x1`, `1e0` and `01` as 1.
const USER_ID = /^[1-9]\d*$/;

// Constructor DI without a decorator: `laratype:di` records `UserService` as this class's dependency.
export default class UserController extends Controller implements ControllerOf<typeof usersContract> {

  constructor(private readonly userService: UserService) {
    super();
  }

  public index() {
    return { data: this.userService.all() };
  }

  public show({ params }: Ctx<typeof usersContract.show>) {
    const user = USER_ID.test(params.id) ? this.userService.find(Number(params.id)) : undefined;
    if (!user) throw errors.notFound();
    return user;
  }

  public store({ body }: Ctx<typeof usersContract.store>) {
    return this.userService.create(body);
  }
}
