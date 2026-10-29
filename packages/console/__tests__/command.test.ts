import { describe, expect, it } from "vitest";
import { AppServiceProvider, ServiceProvider } from "@laratype/support";
import Command, { overridesProviders } from "../src/command/Command";
import { isConsoleCommand } from "../src/index";

class SendMail extends Command<typeof SendMail.signature> {
  static readonly signature = "send:mail {user} {--queue=} {--force}" as const;

  static description = "Send the welcome mail";
}

describe("Command", () => {
  it("reads the input filled from the signature", () => {
    const command = new SendMail();
    command.__setInput({ user: "alice", queue: "high", force: true });
    expect(command.argument("user")).toBe("alice");
    expect(command.option("queue")).toBe("high");
    expect(command.option("force")).toBe(true);
  });

  it("returns undefined for a value the signature declares but the input does not hold", () => {
    const command = new SendMail();
    command.__setInput({ user: "alice" });
    expect(command.option("queue")).toBeUndefined();
    expect(command.option("force")).toBeUndefined();
    expect(new SendMail().argument("user")).toBeUndefined();
  });

  it("keeps the 0.5 surface: opts(), boot(), handle() and provider filtering", async () => {
    const command = new SendMail();
    expect(command.opts()).toBeUndefined();
    await expect(command.boot()).resolves.toBeUndefined();
    expect(command.handle()).toBeUndefined();
    const providers = [ServiceProvider, AppServiceProvider] as Array<typeof ServiceProvider | typeof AppServiceProvider>;
    await expect(command.providers(providers)).resolves.toBe(providers);
  });

  it("finds a providers() override below an inherited base, across console copies", () => {
    class Base extends Command {
      public async providers(providers: Array<typeof ServiceProvider | typeof AppServiceProvider>) {
        return providers;
      }
    }
    class Child extends Base {}

    expect(overridesProviders(SendMail)).toBe(false);
    expect(overridesProviders(Base)).toBe(true);
    expect(overridesProviders(Child)).toBe(true);
  });
});

describe("isConsoleCommand", () => {
  it("accepts a class with a static signature and a closure command", async () => {
    const { command } = await import("../src/command/closure");
    expect(isConsoleCommand(SendMail)).toBe(true);
    expect(isConsoleCommand(command("send:mail {user}", () => undefined))).toBe(true);
    expect(isConsoleCommand(class Helper {})).toBe(false);
    expect(isConsoleCommand({ signature: "send:mail" })).toBe(false);
  });
});
