// Input for scripts/gen.mjs: the flattened, schema-free API type the generator prints.
import type { AppApi } from "../app/contracts";
import type { ApiTypes } from "../../contract";

export type Flat = ApiTypes<AppApi>;
