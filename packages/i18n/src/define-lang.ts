import type { LangTree } from "./types";

/**
 * Types a translation file (`lang/<locale>/<file>.ts`), keeping every key and message literal so `trans()` infers the
 * key and its placeholders (I1 #167).
 */
export const defineLang = <const T extends LangTree>(messages: T): T => messages;
