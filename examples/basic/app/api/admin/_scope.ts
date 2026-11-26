// app/api/admin/_scope.ts: every contract under admin/ inherits the admin guard (auth.md › Authentication from the contract)
import "../_guards";
import { defineScope } from "@laratype/contract";
import type { ScopePrefix } from "./$types";

export default defineScope<ScopePrefix>()({ auth: "admin" });
