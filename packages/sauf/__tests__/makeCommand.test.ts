import { describe, expect, it } from "vitest";
import { assertCommandSignature, commandSignature } from "../src/commands/make/command";

describe("commandSignature", () => {
  it("joins camelCase words with a colon", () => {
    expect(commandSignature("SendMail")).toBe("send:mail");
    expect(commandSignature("TypesGenerate")).toBe("types:generate");
  });

  it("drops the empty segment a leading, trailing or doubled underscore would add", () => {
    // `_CleanCache` used to give `:clean:cache`, which the next CLI run rejected at registration.
    expect(commandSignature("_CleanCache")).toBe("clean:cache");
    expect(commandSignature("CleanCache_")).toBe("clean:cache");
    expect(commandSignature("Clean__Cache")).toBe("clean:cache");
    expect(commandSignature("Clean:Cache")).toBe("clean:cache");
    expect(commandSignature("Clean::Cache")).toBe("clean:cache");
  });
});

describe("assertCommandSignature", () => {
  it("accepts the signature commandSignature derives", () => {
    expect(() => assertCommandSignature("CleanCache", commandSignature("CleanCache"))).not.toThrow();
  });

  it("names the command when registration would reject the derived signature", () => {
    expect(() => assertCommandSignature("Clean.Mail", commandSignature("Clean.Mail"))).toThrow(
      'make:command: "Clean.Mail" does not give a valid signature: Invalid command signature "clean.mail": "clean.mail" is not a valid command name',
    );
  });

  it("rejects a name made only of separators", () => {
    expect(() => assertCommandSignature("___", commandSignature("___"))).toThrow(
      'make:command: "___" does not give a valid signature: Invalid command signature "": the signature is empty',
    );
  });
});
