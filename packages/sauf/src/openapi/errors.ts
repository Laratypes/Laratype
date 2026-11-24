/**
 * A failure of `sauf openapi:generate` itself: the document cannot be generated. The message is printed as is, so it
 * carries the command prefix; the `cause` keeps the underlying error (a resolution or import failure) unprinted.
 */
export class OpenApiGenerationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`[sauf openapi:generate] ${message}`, options);
    this.name = "OpenApiGenerationError";
  }
}
