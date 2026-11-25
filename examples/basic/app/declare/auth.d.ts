import type User from "../models/User";
import type Admin from "../models/Admin";

// The app's auth types (A1 #119, docs/v1/auth.md › Typed Register). A `.d.ts` of its own, not app/config/auth.ts:
// the augmentation describes the app's public auth surface, and every file of the example's program sees it.
// Keep the guard names in sync with app/api/_guards.ts, which the contract tree's own type check reads.
declare module "@laratype/auth" {
  interface Register {
    user: User;
    guards: {
      web: true;
      api: true;
      admin: { user: Admin };
    };
  }
}
