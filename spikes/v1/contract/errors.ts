import type { ErrorDef } from "./endpoint";

export const defineError = <St extends number, Body>(status: St, code: string): ErrorDef<St, Body> => ({ status, code });

export const errors = {
  validation: defineError<422, { message: string; errors: Record<string, string[]> }>(422, "VALIDATION_ERROR"),
  notFound: defineError<404, { message: string }>(404, "NOT_FOUND"),
  forbidden: defineError<403, { message: string }>(403, "FORBIDDEN"),
  unauthorized: defineError<401, { message: string }>(401, "UNAUTHORIZED"),
};
