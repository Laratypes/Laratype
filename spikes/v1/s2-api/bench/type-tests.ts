// The zod 4 / v4-mini contract copies must produce the same client-facing types as the zod 3 ones.
import type { AppApi as Z3 } from "../app/contracts";
import type { AppApi as Z4 } from "./contracts-zod4";
import type { AppApi as Mini } from "./contracts-zod4-mini";
import type { ApiTypes } from "../../contract";

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const expect = <T extends true>() => {};
type Deep<T> = T extends object ? { [K in keyof T]: Deep<T[K]> } : T;

expect<Equal<Deep<ApiTypes<Z3>>, Deep<ApiTypes<Z4>>>>();
expect<Equal<Deep<ApiTypes<Z3>>, Deep<ApiTypes<Mini>>>>();
