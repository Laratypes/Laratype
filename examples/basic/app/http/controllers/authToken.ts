import type { Authenticated } from "@laratype/auth";
import type { Model } from "@laratype/database";

/** The one JWT the example's password login routes issue. */
export const issueDefaultToken = <T extends Model>(authenticated: Authenticated<T>) =>
  authenticated.generateToken({
    name: "Default Token",
    abilities: "*",
  });
