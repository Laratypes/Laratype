import { z } from "zod";
import { defineContract, endpoint, errors } from "../../../contract";

export const UserDto = z.object({ id: z.number(), name: z.string(), email: z.string().email() });

export const users = defineContract("users", {
  index: endpoint.get("/users").query(z.object({ page: z.coerce.number().default(1) })).response(z.array(UserDto)),
  show: endpoint.get("/users/:user").response(UserDto).errors(errors.notFound),
  store: endpoint
    .post("/users")
    .body(z.object({ name: z.string().min(1), email: z.string().email() }))
    .response(UserDto, 201)
    .errors(errors.validation),
  destroy: endpoint.delete("/users/:user").errors(errors.forbidden, errors.notFound),
});
