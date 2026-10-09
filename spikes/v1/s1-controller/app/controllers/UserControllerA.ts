// Option A: class methods with an explicit Ctx<> annotation.
import { users } from "../../../s2-api/app/contracts/users";
import { errors } from "../../../contract";
import type { Ctx } from "../../lib/ctx";
import { fail } from "../../lib/ctx";
import type { User } from "../models/User";
import { UserRepository } from "../repositories/UserRepository";

export class UserControllerA {
  // constructor DI (S3): parameter property, no decorator
  constructor(private readonly repo: UserRepository) {}

  async index({ query }: Ctx<typeof users.index>) {
    return this.repo.list(query.page);
  }

  async show({ params }: Ctx<typeof users.show, { params: { user: User } }>) {
    return { id: params.user.id, name: params.user.name, email: params.user.email };
  }

  async store({ body }: Ctx<typeof users.store>) {
    return this.repo.create(body);
  }

  async destroy({ params, user }: Ctx<typeof users.destroy, { params: { user: User }; user: User }>) {
    if (user.role !== "admin") return fail(errors.forbidden, { message: `cannot delete ${params.user.id}` });
  }
}
