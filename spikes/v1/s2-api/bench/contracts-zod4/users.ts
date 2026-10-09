// zod 4 classic copy of app/contracts. Note: v4 `z.coerce.number()` has input type `unknown`; `<number>` keeps the client type.
import * as z from "zod/v4";
import { defineContract, endpoint, errors } from "../../../contract";

export const UserDto = z.object({ id: z.number(), name: z.string(), email: z.string().email() });

export const users = defineContract("users", {
  index: endpoint.get("/users").query(z.object({ page: z.coerce.number<number>().default(1) })).response(z.array(UserDto)),
  show: endpoint.get("/users/:user").response(UserDto).errors(errors.notFound),
  store: endpoint
    .post("/users")
    .body(z.object({ name: z.string().min(1), email: z.string().email() }))
    .response(UserDto, 201)
    .errors(errors.validation),
  destroy: endpoint.delete("/users/:user").errors(errors.forbidden, errors.notFound),
});
