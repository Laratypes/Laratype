import { Controller } from "@laratype/http";
import type { Ctx } from "@laratype/http";
import adminsContract from "../../../api/admin/admins";
import adminMeContract from "../../../api/admin/me";
import { toAdminProfile } from "../../../api/_schemas";
import type Admin from "../../../models/Admin";

export default class AdminHomeController extends Controller {

  public me({ user }: Ctx<typeof adminMeContract.me, { user: Admin }>) {
    return toAdminProfile(user);
  }

  public show({ params }: Ctx<typeof adminsContract.show, { params: { admin: Admin } }>) {
    return toAdminProfile(params.admin);
  }

}
