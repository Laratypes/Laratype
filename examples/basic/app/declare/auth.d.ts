import type User from "../src/models/User";

// The app's auth types (A1 #119, docs/v1/auth.md › Typed Register). A `.d.ts` of its own, not app/config/auth.ts:
// the augmentation describes the app's public auth surface, and every file of the example's program sees it.
declare module "@laratype/auth" {
  interface Register {
    user: User;
    guards: {
      web: true;
      api: true;
      admin: true;
    };
  }
}
