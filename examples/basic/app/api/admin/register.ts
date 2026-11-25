// app/api/admin/register.ts → /api/admin/register, route name admin.register.register
import { defineContract, endpoint } from "@laratype/contract";
import { RegisterBody, AdminProfile } from "../_schemas";
import type { Prefix } from "./$types";

/**
 * Admin-only: the admin scope supplies `auth: 'admin'` and the endpoint runs `AdminPolicy.register`, so an existing
 * Admin creates the next one. A fresh database gets its first admin from `database/seeders/AdminSeeder.ts`.
 */
export default defineContract<Prefix>()({
  register: endpoint.post("/").authorize().body(RegisterBody).response(AdminProfile),
});
