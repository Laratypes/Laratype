// app/api/users.ts → /api/users, route names users.index, users.show and users.store (docs/v1/contract.md › Contract folder tree)
import { defineContract, endpoint } from "@laratype/contract";
import { z } from "zod";
import type { Prefix } from "./$types";

/** The wire shape of an in-memory user, shared with the tests. */
export const UserDto = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
});

const UserList = z.object({ data: z.array(UserDto) });

const NewUser = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

/** The contract is authenticated; every endpoint mounts `UserPolicy` with `r.contract(...)` (H8 #122). */
export default defineContract<Prefix>()({
  index: endpoint.get("/").authorize().response(UserList),
  show: endpoint.get("/:id").authorize().response(UserDto),
  store: endpoint.post("/").authorize().body(NewUser).response(UserDto, 201),
}, { auth: true });
