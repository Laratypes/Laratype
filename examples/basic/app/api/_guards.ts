// The contract tree's own type check (sauf types:generate) imports only the contracts, so it does not see the app's
// `Register` augmentation in app/declare/auth.d.ts. This mirrors its guard names for the contract options (the app's
// Register still types each guard's user in the full program).
declare module "@laratype/contract" {
  interface GuardRegistry {
    web: true;
    api: true;
    admin: true;
  }
}

export {};
