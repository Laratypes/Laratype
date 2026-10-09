// S2 FE type tests (compiled by fe/tsconfig.json: types: [], DOM lib).
import type { AppApi } from "@app/contracts";
import type { ApiTypes } from "../../../contract";
import { api as a } from "./a";
import { api as b } from "./b";
import { api as c } from "./c";

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const expect = <T extends true>() => {};
type Api = ApiTypes<AppApi>;

// shape
expect<Equal<Api["users"]["show"]["params"], { user: string }>>();
expect<Equal<Api["users"]["index"]["status"], 200>>(); // regression: was `any` before NoInfer in Endpoint.response()
expect<Equal<Api["users"]["store"]["status"], 201>>();
expect<Equal<Api["users"]["destroy"]["errors"]["status"], 403 | 404>>();

async function cases() {
  // (a) name-style, value import
  // @ts-expect-error params required
  await a.users.show();
  // @ts-expect-error user must be a string
  await a.users.show({ params: { user: 1 } });
  // @ts-expect-error body shape
  await a.users.store({ body: { name: "x" } });
  await a.users.index(); // query is optional (page has a default)
  const r = await a.users.destroy({ params: { user: "1" } });
  if (!r.ok && !("unexpected" in r)) expect<Equal<typeof r.status, 403 | 404>>();

  // (b) path-style, type-only
  // @ts-expect-error unknown path
  await b.get("/nope");
  // @ts-expect-error '/users' has no POST body of this shape
  await b.post("/users", { body: { title: "x" } });
  // @ts-expect-error GET /users/:user/posts needs params
  await b.get("/users/:user/posts");
  // @ts-expect-error GET has no body
  await b.get("/users/:user", { params: { user: "1" }, body: {} });

  // (c) manifest
  // @ts-expect-error params required
  await c.users.show();
  const s = await c.posts.store({ params: { user: "1" }, body: { title: "t", body: "b" } });
  if (s.ok) expect<Equal<typeof s.data, { id: number; userId: number; title: string; body: string }>>();
}
void cases;
