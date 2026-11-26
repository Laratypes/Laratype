import { Controller } from "@laratype/http";
import type { Ctx } from "@laratype/http";
import adminRegisterContract from "../../../api/admin/register";
import { toAdminProfile } from "../../../api/_schemas";
import Admin from "../../../models/Admin";

export default class AdminRegisterController extends Controller {

  public async register({ body }: Ctx<typeof adminRegisterContract.register>) {
    return toAdminProfile(await Admin.save(body));
  }

}
