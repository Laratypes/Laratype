// Same endpoints as app/contracts/users.ts, written with zod/v4-mini (functional, tree-shakable API).
import * as z from "zod/v4-mini";
import { defineContract, endpoint, errors } from "../../../contract";

export const UserDto = z.object({ id: z.number(), name: z.string(), email: z.email() });

export const users = defineContract("users", {
  index: endpoint.get("/users").query(z.object({ page: z._default(z.coerce.number<number>(), 1) })).response(z.array(UserDto)),
  show: endpoint.get("/users/:user").response(UserDto).errors(errors.notFound),
  store: endpoint
    .post("/users")
    .body(z.object({ name: z.string().check(z.minLength(1)), email: z.email() }))
    .response(UserDto, 201)
    .errors(errors.validation),
  destroy: endpoint.delete("/users/:user").errors(errors.forbidden, errors.notFound),
});
