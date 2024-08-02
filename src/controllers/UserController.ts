import { Controller, Request } from "@laratype/core";
import { prisma } from "../../config/database/prisma";
import CreateUserRequest from "../requests/CreateUserRequest";
import UserCollection from "../resources/UserCollection";


export default class UserController extends Controller {

  async store(request: CreateUserRequest) {
    const params = request.validated();
    return prisma.users.create({
      data: params
    })
  }

  async index() {
    const users = await prisma.users.findMany({})
    return new UserCollection(users)
  }
}