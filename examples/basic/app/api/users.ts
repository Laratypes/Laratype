// app/api/users.ts → /api/users, route names users.index, users.show and users.store (docs/v1/contract.md › Contract folder tree)
import { defineContract, endpoint, errors } from "@laratype/contract";
import { z } from "zod";
import type { Prefix } from "./$types";

/** The wire shape of a user, shared with the tests. */
export const UserDto = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
});

const NewUser = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export default defineContract<Prefix>()({
  index: endpoint.get("/").response(z.object({ data: z.array(UserDto) })),
  show: endpoint.get("/:id").response(UserDto).throws(errors.notFound),
  store: endpoint.post("/").body(NewUser).response(UserDto, 201),
});
