// Intentionally failing. NOT part of the main tsc project: compiled alone by scripts/check-s1-s2.mjs,
// and the raw tsc output is saved to s1-controller/tsc-errors.txt. The same cases live in
// type-tests.ts with `// @ts-expect-error`.
import { users } from "../../s2-api/app/contracts/users";
import { createRouter } from "../lib/router";
import { action, type Ctx } from "../lib/ctx";
import { User } from "../app/models/User";
import { auth } from "../app/middleware/auth";
import { UserControllerA } from "../app/controllers/UserControllerA";
import { UserControllerB } from "../app/controllers/UserControllerB";

const r = createRouter();

// [b1] Option A: no auth() middleware -> users.destroy needs `user`
r.bind({ user: User }).contract(users, UserControllerA);

// [b2] Option B: auth() but no .bind() -> show/destroy need params.user: User, route gives string
r.middleware(auth()).contract(users, UserControllerB);

// [b3] nothing provided at all
r.contract(users, UserControllerA);

// [a1] Option A: wrong return shape -> reported at r.contract() (no contextual return type on methods)
class WrongReturnA {
  async index() { return []; }
  async show({ params }: Ctx<typeof users.show>) { return { id: params.user, name: "x" }; }
  async store() { return { id: 1, name: "x", email: "x@y.z" }; }
  async destroy() {}
}
r.contract(users, WrongReturnA);

// [a2] Option B: wrong return shape -> reported at the handler itself
class WrongReturnB {
  index = action(users.index, async () => []);
  show = action(users.show, async ({ params }) => ({ id: params.user, name: "x" }));
  store = action(users.store, async () => ({ id: 1, name: "x", email: "x@y.z" }));
  destroy = action(users.destroy, async () => {});
}

// [e1] missing handler (exhaustiveness) + bind key that is not a path param
class Incomplete {
  async index() { return []; }
}
r.bind({ usr: User }).contract(users, Incomplete);
