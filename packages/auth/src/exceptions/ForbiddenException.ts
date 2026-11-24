import { Exception } from "@laratype/support";

/**
 * A denied policy or gate check (#121): 403 with the response body `{ code: "FORBIDDEN", message }`, the same body as
 * the contract's derived `errors.forbidden()` (`docs/v1/auth.md › Policies and gates`). A responsible 4xx `Exception`
 * is answered with its own body (http.md › Exceptions), so no contract import is needed here.
 */
export default class ForbiddenException extends Exception {

  constructor(message = "This action is unauthorized.") {
    super({
      code: "FORBIDDEN",
      httpCode: 403,
      message,
      responsible: true,
      reportable: false,
    })
  }

}
