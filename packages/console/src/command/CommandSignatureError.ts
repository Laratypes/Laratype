/** A malformed signature. Thrown at registration time, before commander parses anything. */
export class CommandSignatureError extends Error {
  override name = "CommandSignatureError";

  readonly signature: string;

  constructor(signature: string, reason: string) {
    super(`Invalid command signature ${JSON.stringify(signature)}: ${reason}`);
    this.signature = signature;
  }
}
