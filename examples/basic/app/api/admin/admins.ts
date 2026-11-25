// app/api/admin/admins.ts → /api/admin/admins/:admin, route name admin.admins.show
import { defineContract, endpoint } from "@laratype/contract";
import { AdminProfile } from "../_schemas";
import type { Prefix } from "./$types";

export default defineContract<Prefix>()({
  show: endpoint.get("/:admin").authorize().response(AdminProfile),
});
