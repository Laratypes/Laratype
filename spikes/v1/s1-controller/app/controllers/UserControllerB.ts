// Option B: property handlers built with action().
import { users } from "../../../s2-api/app/contracts/users";
import { errors } from "../../../contract";
import type { Ctx } from "../../lib/ctx";
import { action, fail } from "../../lib/ctx";
import type { User } from "../models/User";
import { UserRepository } from "../repositories/UserRepository";

export class UserControllerB {
  constructor(private readonly repo: UserRepository) {}

  // no annotation: ctx is contextually typed from the endpoint
  index = action(users.index, async ({ query }) => this.repo.list(query.page));

  // requirements still need an annotation: there is no value to infer them from
  show = action(users.show, async ({ params }: Ctx<typeof users.show, { params: { user: User } }>) => ({
    id: params.user.id,
    name: params.user.name,
    email: params.user.email,
  }));

  store = action(users.store, async ({ body }) => this.repo.create(body));

  destroy = action(users.destroy, async ({ params, user }: Ctx<typeof users.destroy, { params: { user: User }; user: User }>) => {
    if (user.role !== "admin") return fail(errors.forbidden, { message: `cannot delete ${params.user.id}` });
  });
}
