import { Controller } from "@laratype/http";
import CreateAdminRequest from "../../requests/admin/CreateAdminRequest";
import Admin from "../../../models/Admin";

export default class AdminRegisterController extends Controller {

  async register(request: CreateAdminRequest) {

    const admin = await Admin.save(request.validated());

    return admin;
  }

  
}