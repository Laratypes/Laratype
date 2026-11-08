import type { AppServiceProvider, ServiceProvider } from "@laratype/support";
import { Command as BaseCommand, CommandSignatureError } from "@laratype/console";
import { describe, expect, it } from "vitest";
import Command, { assertCommandNameFree } from "../src/utils/command";
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

/** A 0.5 variadic argument followed by a distinct signature argument: Commander cannot register the order. */
class LegacyBeforeSignature extends BaseCommand {
  static readonly signature = "legacy:mixed {user}" as const;

  static arguments = [{ name: "<names...>" }];

  static bootsApp = false;
}

/** Two 0.5 arguments with the variadic one first: the same order failure, inside the 0.5 declarations. */
class LegacyOrder extends BaseCommand {
  static readonly signature = "legacy:order" as const;

  static arguments = [{ name: "<names...>" }, { name: "<user>" }];

  static bootsApp = false;
}

describe("the command wrapper", () => {
  it("maps a signature argument deduplicated against a 0.5 static argument to the same positional value", async () => {
    const transpiler = { close: async () => {} } as unknown as Transpile;
    const wrapper = new Command(LegacyNames, transpiler);
    await wrapper.getCommander().parseAsync(["a", "b"], { from: "user" });
    expect(LegacyNames.seen).toEqual(["a", "b"]);
  });

  it("rejects a variadic argument that is not last in the merged, deduplicated list", () => {
    const transpiler = { close: async () => {} } as unknown as Transpile;
    const message = (signature: string) =>
      `Invalid command signature "${signature}": "names" is variadic, so it must be the last argument`;

    // The 0.5 variadic comes first in registration order, before the distinct signature argument
    expect(() => new Command(LegacyBeforeSignature, transpiler)).toThrow(CommandSignatureError);
    expect(() => new Command(LegacyBeforeSignature, transpiler)).toThrow(
      message("legacy:mixed {user}"),
    );

    // The same failure between two 0.5 declarations, before Commander registers either
    expect(() => new Command(LegacyOrder, transpiler)).toThrow(message("legacy:order"));
  });
});

describe("duplicate command names", () => {
  it("names both sources instead of commander's addCommand error", () => {
    const registered = new Map([["route:list", "a framework command"]]);
    expect(() => assertCommandNameFree("route:list", registered, "a command file")).toThrow(
      'Duplicate command "route:list": a framework command and a command file register it. Fix: rename one.',
    );
  });

  it("rejects a duplicate even when the first registration has an empty source label", () => {
    const registered = new Map([["route:list", ""]]);
    expect(() => assertCommandNameFree("route:list", registered, "a command file")).toThrow(
      'Duplicate command "route:list": an unnamed source and a command file register it. Fix: rename one.',
    );
  });

  it("accepts a name no command registered yet", () => {
    expect(() => assertCommandNameFree("route:list", new Map(), "a command file")).not.toThrow();
  });
});
