// The contract tree of the client-query tests, mounted like a generated appApi: a root contract, a nested folder
// (`users.posts`), an endpoint without a response schema, and a domain error to type the mutation's errors.
import * as z from "zod";
import { defineApi, defineContract, defineError, endpoint } from "@laratype/contract";

/** 409, the domain error of `users.store`; its wire body is `{ message, email }`. */
export const EmailTaken = defineError(409, "EMAIL_TAKEN", (email: string) => ({ message: "The email is taken.", email }));

export const UserDto = z.object({ id: z.number(), name: z.string(), email: z.string() });
const PostDto = z.object({ id: z.number(), title: z.string() });

// app/api/users.ts -> /api/users, api.users
const users = defineContract()(
  {
    index: endpoint.get("/").query(z.object({ page: z.coerce.number().optional() })).response(z.array(UserDto)),
    show: endpoint.get("/:user").response(UserDto),
    store: endpoint
      .post("/")
      .body(z.object({ name: z.string(), email: z.string() }))
      .response(UserDto, 201)
      .throws(EmailTaken),
  },
  { auth: true },
);

// app/api/users/[user]/posts.ts -> /api/users/:user/posts, api.users.posts. `remove` answers 204: no response schema.
const posts = defineContract()({
  index: endpoint.get("/").response(z.array(PostDto)),
  update: endpoint.patch("/:post").body(PostDto.pick({ title: true })).response(PostDto),
  remove: endpoint.delete("/:post"),
});

// app/api/health/index.ts -> /api/health, api.health
const health = defineContract()({
  check: endpoint.get("/").response(z.object({ ok: z.boolean() })),
});

export const appApi = defineApi({
  users: { contract: users, path: "/api/users", scopes: [] },
  "users.posts": { contract: posts, path: "/api/users/:user/posts", scopes: [] },
  health: { contract: health, path: "/api/health", scopes: [] },
});

export type AppApi = typeof appApi;
