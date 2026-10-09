// S1 type tests. Part of the main tsc project (spikes/v1/tsconfig.json): an unused `@ts-expect-error`
// is itself an error, so `tsc -p spikes/v1` passing proves every case below fails where it should.
import { users } from "../../s2-api/app/contracts/users";
import { errors } from "../../contract";
import { createRouter, type Provided } from "../lib/router";
import { action, fail, type Ctx, type ControllerOf } from "../lib/ctx";
import { User } from "../app/models/User";
import { auth, tenant } from "../app/middleware/auth";
import { UserControllerA } from "../app/controllers/UserControllerA";
import { UserControllerB } from "../app/controllers/UserControllerB";
import { UserRepository } from "../app/repositories/UserRepository";

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const expect = <T extends true>() => {};

const r = createRouter();

// ---- positive ---------------------------------------------------------------
r.middleware(auth()).bind({ user: User }).contract(users, UserControllerA);
r.middleware(auth()).bind({ user: User.find }).contract(users, UserControllerB);
r.middleware(tenant(), auth()).bind({ user: User }).contract(users, UserControllerA); // extra context is fine

// Option B: ctx is contextually typed from the endpoint, no annotation
action(users.index, async (ctx) => {
  expect<Equal<typeof ctx.query, { page: number }>>();
  expect<Equal<typeof ctx.params, {}>>();
  return [];
});
action(users.store, async ({ body }) => {
  expect<Equal<typeof body, { name: string; email: string }>>();
  return { id: 1, ...body };
});
// requirements merge into params one level deep
expect<Equal<Ctx<typeof users.show, { params: { user: User }; user: User }>["params"], { user: User }>>();

// ---- (a) wrong return shape ---------------------------------------------------
// B: error at the handler (reported on the arrow argument, since C is a generic inferred from it)
// @ts-expect-error id must be number, email missing
action(users.show, async ({ params }) => ({ id: params.user, name: "x" }));
// A: error at r.contract() ...
class WrongReturnA {
  async index() { return []; }
  async show({ params }: Ctx<typeof users.show>) { return { id: params.user, name: "x" }; }
  async store() { return { id: 1, name: "x", email: "x@y.z" }; }
  async destroy() {}
}
// @ts-expect-error users.show: return type does not match the response schema
r.contract(users, WrongReturnA);
// ... or at the method with `implements ControllerOf<typeof users>`
class WrongReturnA2 implements ControllerOf<typeof users> {
  async index() { return []; }
  // @ts-expect-error Property 'show' ... is not assignable to the same property in base type
  async show({ params }: Ctx<typeof users.show>) { return { id: params.user, name: "x" }; }
  async store() { return { id: 1, name: "x", email: "x@y.z" }; }
  async destroy() {}
}
// errors not declared on the endpoint are rejected
// @ts-expect-error users.show declares notFound only
action(users.show, async () => fail(errors.forbidden, { message: "no" }));
action(users.show, async () => fail(errors.notFound, { message: "gone" }));

// ---- (b) missing middleware / binding errors at r.contract() ------------------
// @ts-expect-error users.destroy: handler requires `user` (no auth())
r.bind({ user: User }).contract(users, UserControllerA);
// @ts-expect-error users.show / users.destroy: `params.user` is string, handler requires User (no .bind())
r.middleware(auth()).contract(users, UserControllerB);
// @ts-expect-error both
r.contract(users, UserControllerA);
// @ts-expect-error unknown bind key
r.middleware(auth()).bind({ user: User, usr: User }).contract(users, UserControllerA);
// @ts-expect-error exhaustiveness: show/store/destroy missing
r.contract(users, class { async index() { return []; } });
class WrongEndpointB {
  constructor(private repo: UserRepository) {}
  index = action(users.index, async ({ query }) => this.repo.list(query.page));
  show = action(users.index, async () => []); // typed for users.index
  store = action(users.store, async ({ body }) => this.repo.create(body));
  destroy = action(users.destroy, async () => {});
}
// @ts-expect-error users.show: handler ctx is typed for a different endpoint
r.contract(users, WrongEndpointB);

// ---- why not function assignability: method bivariance ------------------------
type NaiveCheck<I, Pv> = I extends { destroy(ctx: Pv): unknown } ? true : false;
type ProvidedNoAuth = Provided<typeof users.destroy, {}, { user: typeof User }>;
// UserControllerA.destroy REQUIRES `user`, the route does not provide it, yet the naive check accepts it:
expect<NaiveCheck<UserControllerA, ProvidedNoAuth>>();
// the one-directional conditional rejects it:
type Param = Parameters<UserControllerA["destroy"]>[0];
expect<Equal<[ProvidedNoAuth] extends [Param] ? true : false, false>>();

// ---- constructor DI x class fields (target ES2022 => useDefineForClassFields: true) ---
class EagerB {
  constructor(private readonly repo: UserRepository) {}
  ok = action(users.index, async ({ query }) => this.repo.list(query.page)); // lazy: fine
  // @ts-expect-error TS2729 Property 'repo' is used before its initialization (throws at runtime under SWC too)
  eager = this.repo.list.bind(this.repo);
}
