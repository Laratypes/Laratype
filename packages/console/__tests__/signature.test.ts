import { describe, expect, it } from "vitest";
import { command, isClosureCommand } from "../src/command/closure";
import { CommandSignatureError, optionKey, parseSignature } from "../src/command/signature";

describe("parseSignature", () => {
  it("reads the command name, arguments, options and the ` : ` description", () => {
    expect(parseSignature("send:mail")).toEqual({ name: "send:mail", description: undefined, arguments: [], options: [] });
    expect(parseSignature("send:mail {user} {--queue=} : Send the welcome mail")).toEqual({
      name: "send:mail",
      description: "Send the welcome mail",
      arguments: [{ name: "user", kind: "required" }],
      options: [{ name: "queue", key: "queue", kind: "value" }],
    });
  });

  it("reads every argument form: required, optional, default and rest", () => {
    const parsed = parseSignature("deploy {env=production} {tags*} {force?} {user}");
    expect(parsed.arguments).toEqual([
      { name: "env", kind: "default", default: "production" },
      { name: "tags", kind: "rest" },
      { name: "force", kind: "optional" },
      { name: "user", kind: "required" },
    ]);
  });

  it("reads every option form, with the camelCase key commander stores", () => {
    const parsed = parseSignature("deploy {--dry-run} {--level=info} {--tag=*} {--queue=}");
    expect(parsed.options).toEqual([
      { name: "dry-run", key: "dryRun", kind: "flag" },
      { name: "level", key: "level", kind: "value", default: "info" },
      { name: "tag", key: "tag", kind: "rest" },
      { name: "queue", key: "queue", kind: "value" },
    ]);
  });

  it("accepts odd whitespace and a description after the parameters", () => {
    expect(parseSignature("  send:mail   {user}   :   Say hello  ")).toEqual({
      name: "send:mail",
      description: "Say hello",
      arguments: [{ name: "user", kind: "required" }],
      options: [],
    });
  });

  it("optionKey matches commander's camelcase", () => {
    expect(optionKey("dry-run")).toBe("dryRun");
    expect(optionKey("a-b-c")).toBe("aBC");
    expect(optionKey("queue")).toBe("queue");
  });

  it("rejects a malformed signature with the signature in the message", () => {
    const cases: Array<[string, string]> = [
      ["", "the signature is empty"],
      ["send mail", '"mail" is neither an argument nor an option'],
      ["send:mail {user", '"{user" is neither an argument nor an option'],
      ["send:mail {--}", '"--" is not a valid option name'],
      ["send:mail {--dry--run}", '"--dry--run" is not a valid option name'],
      ["send:mail {--dry-}", '"--dry-" is not a valid option name'],
      ["send:mail {-q}", "uses a short option"],
      ["send:mail {1user}", '"1user" is not a valid argument name'],
      ["send:mail {user} {user}", '"user" is declared twice'],
      ["send:mail {--dry-run} {--dry-run}", '"dryRun" is declared twice'],
      ["send:mail {--dry-run} {--dryRun}", '"dryRun" is declared twice'],
      ["send:mail {user} {--user}", '"user" is declared twice'],
    ];
    for (const [signature, reason] of cases) {
      expect(() => parseSignature(signature)).toThrow(CommandSignatureError);
      expect(() => parseSignature(signature)).toThrow(reason);
      expect(() => parseSignature(signature)).toThrow(signature === "" ? '""' : signature);
    }
  });
});

describe("command()", () => {
  it("builds a closure command that isClosureCommand() recognises", () => {
    const handler = () => "sent";
    const send = command("send:mail {user}", handler);
    expect(send.signature).toBe("send:mail {user}");
    expect(send.handler).toBe(handler);
    expect(send.description).toBeUndefined();
    expect(isClosureCommand(send)).toBe(true);
  });

  it("takes an explicit description", () => {
    const send = command("send:mail {user}", "Send the welcome mail", () => undefined);
    expect(send.description).toBe("Send the welcome mail");
  });

  it("rejects anything that is not a closure command", () => {
    class SendMail {
      static signature = "send:mail";
    }
    expect(isClosureCommand(SendMail)).toBe(false);
    expect(isClosureCommand({ signature: "send:mail", handler: () => undefined })).toBe(false);
    expect(isClosureCommand(undefined)).toBe(false);
    expect(isClosureCommand(null)).toBe(false);
  });
});
