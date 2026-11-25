import { Controller } from "@laratype/http";
import type { Ctx } from "@laratype/http";
import { toUserProfile } from "../../api/_schemas";
import registerContract from "../../api/register";
import User from "../../models/User";

export default class RegisterController extends Controller {

  public async register({ body }: Ctx<typeof registerContract.register>) {
    // The 0.5 signup (POST /api/register) still persists through the User model; /api/users uses the demo UserService.
    return toUserProfile(await User.save({
      ...body,
      isActive: true,
    }));
  }

}
