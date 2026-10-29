// Type tests for the typed command signature (F2 #161), run by `vitest --typecheck.only`.
import { describe, expectTypeOf, test } from "vitest";
import Command from "../src/command/Command";
import { command } from "../src/command/closure";
import type { ArgumentName, CommandInput, OptionName } from "../src/command/signature";
import type { AnyClosureCommand, ClosureCommand, CommandClass, ConsoleCommand } from "../src/index";

class SendMail extends Command<typeof SendMail.signature> {
  static readonly signature = "send:mail {user} {--queue=} {--force} {--dry-run}" as const;

  handle() {
    expectTypeOf(this.argument("user")).toEqualTypeOf<string>();
    expectTypeOf(this.option("queue")).toEqualTypeOf<string | undefined>();
    expectTypeOf(this.option("force")).toEqualTypeOf<boolean | undefined>();
    expectTypeOf(this.option("dry-run")).toEqualTypeOf<boolean | undefined>();

    // @ts-expect-error an unknown argument
    this.argument("receiver");
    // @ts-expect-error an unknown option
    this.option("retries");
    // @ts-expect-error an option is not an argument
    this.argument("queue");
    // @ts-expect-error the flag is named without its dashes
    this.option("--queue");
  }
}

class Loose extends Command {
  static readonly signature = "send:mail {user}";

  handle() {
    expectTypeOf(this.argument("anything")).toEqualTypeOf<string>();
    expectTypeOf(this.option("anything")).toEqualTypeOf<string | boolean | undefined>();
  }
}

class Widened extends Command<typeof Widened.signature> {
  // No `as const` and not readonly: S is string, so the methods stay loose instead of narrowing to `never`
  static signature = "send:mail {user}";

  handle() {
    expectTypeOf(this.argument("user")).toEqualTypeOf<string>();
    expectTypeOf(this.option("queue")).toEqualTypeOf<string | boolean | undefined>();
  }
}

describe("signature types", () => {
  test("the names come from the signature", () => {
    expectTypeOf<ArgumentName<"deploy {env} {tags*} {force?}">>().toEqualTypeOf<"env" | "tags" | "force">();
    expectTypeOf<OptionName<"deploy {--dry-run} {--queue=}">>().toEqualTypeOf<"dry-run" | "queue">();
    expectTypeOf<ArgumentName<string>>().toEqualTypeOf<string>();
    expectTypeOf<OptionName<string>>().toEqualTypeOf<string>();
  });

  test("CommandInput maps arguments and camelCase options to their values", () => {
    expectTypeOf<CommandInput<"deploy {env=production} {tags*} {force?}">>().toEqualTypeOf<{
      env: string;
      tags: string[];
      force: string | undefined;
    }>();
    expectTypeOf<CommandInput<"deploy {--dry-run} {--queue=} {--tag=*} {--level=info}">>().toEqualTypeOf<{
      dryRun: boolean | undefined;
      queue: string | undefined;
      tag: string[] | undefined;
      level: string;
    }>();
    expectTypeOf<CommandInput<"deploy {env} {--dry-run} : deploy the app">>().toEqualTypeOf<{
      env: string;
      dryRun: boolean | undefined;
    }>();
    expectTypeOf<CommandInput<"deploy : the description is not a parameter">>().toEqualTypeOf<{}>();
  });

  test("a non-literal signature falls back to a loose record", () => {
    expectTypeOf<CommandInput<string>>().toEqualTypeOf<Record<string, unknown>>();
  });

  test("negatives", () => {
    // @ts-expect-error an unknown key is not part of the input
    const extra: CommandInput<"deploy {env}"> = { env: "production", force: true };
    // @ts-expect-error a required argument cannot be omitted
    const missing: CommandInput<"deploy {env}"> = {};
    void extra, missing;
  });
});

describe("closure commands", () => {
  test("the handler receives the typed input", () => {
    command("send:mail {user} {--queue=}", (input) => {
      expectTypeOf(input).toEqualTypeOf<{ user: string; queue: string | undefined }>();
    });
    command("deploy {tags*} {--dry-run} : Deploy the app", ({ tags, dryRun }) => {
      expectTypeOf(tags).toEqualTypeOf<string[]>();
      expectTypeOf(dryRun).toEqualTypeOf<boolean | undefined>();
    });
  });

  test("the registration types accept both command shapes", () => {
    const declared: ClosureCommand<"send:mail {user}"> = command("send:mail {user}", ({ user }) => user);
    expectTypeOf(declared.signature).toEqualTypeOf<"send:mail {user}">();
    expectTypeOf(SendMail).toMatchTypeOf<CommandClass>();
    expectTypeOf(declared).toMatchTypeOf<AnyClosureCommand>();
    const fromClass: ConsoleCommand = SendMail;
    const fromClosure: ConsoleCommand = declared;
    expectTypeOf(fromClass).toMatchTypeOf<CommandClass>();
    expectTypeOf(fromClosure).toMatchTypeOf<AnyClosureCommand>();
  });

  test("defaults keep a bare generic usable", () => {
    expectTypeOf<ArgumentName>().toEqualTypeOf<string>();
    expectTypeOf<OptionName>().toEqualTypeOf<string>();
    expectTypeOf<CommandInput>().toEqualTypeOf<Record<string, unknown>>();
  });

  test("negatives", () => {
    // @ts-expect-error the handler cannot destructure an unknown option
    command("send:mail {user}", ({ queue }) => void queue);
  });
});

void SendMail, Loose, Widened;
