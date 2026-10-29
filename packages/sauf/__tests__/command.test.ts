import { AppServiceProvider, ServiceProvider } from "@laratype/support";
import { Command as BaseCommand } from "@laratype/console";
import { describe, expect, it } from "vitest";
import Command from "../src/utils/command";
import type Transpile from "../src/utils/transplie";

/** A 0.5 command that also declares a signature argument with the same name: it is registered once. */
class LegacyNames extends BaseCommand {
  static readonly signature = "legacy:names {names*}" as const;

  static arguments = [{ name: "<names...>" }];

  static bootsApp = false;

  static seen: unknown;

  public async providers(providers: Array<typeof AppServiceProvider | typeof ServiceProvider>) {
    return providers;
  }

  public async handle() {
    LegacyNames.seen = this.argument("names");
  }
}

describe("the command wrapper", () => {
  it("maps a signature argument deduplicated against a 0.5 static argument to the same positional value", async () => {
    const transpiler = { close: async () => {} } as unknown as Transpile;
    const wrapper = new Command(LegacyNames, transpiler);
    await wrapper.getCommander().parseAsync(["a", "b"], { from: "user" });
    expect(LegacyNames.seen).toEqual(["a", "b"]);
  });
});
