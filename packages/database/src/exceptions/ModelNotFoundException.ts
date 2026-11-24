import { NotFoundException } from "@laratype/support";

/**
 * Thrown by `findOrFail()`: an HTTP 404 through the 0.5 `NotFoundException` it extends, so the existing exception
 * filter maps it without a change to `@laratype/http` (docs/v1/database.md › Model).
 *
 * The message names the model and the key for logs and tests; `toJson()` keeps both off the wire.
 */
export default class ModelNotFoundException extends NotFoundException {
  override name = "ModelNotFoundException";

  constructor(target: string, key: unknown) {
    super(`No query results for model [${target}] ${String(key)}`);
  }

  override toJson() {
    return { code: this.getErrorCode(), message: "Resource not found!" };
  }
}
