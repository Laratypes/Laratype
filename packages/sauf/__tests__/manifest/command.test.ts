import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// F2 #161: app commands are resolved by the container (constructor DI, the DI transform of `sauf` dev), a closure
// command in `app/routes/console.ts` gets its typed input, and `make:command` writes the v1 stub. Runs the BUILT sauf
// (`packages/sauf/dist`), like devSsr.test.ts: run `bun run build` first.

const saufBin = fileURLToPath(new URL("../../dist/index.esm.js", import.meta.url));
const here = fileURLToPath(new URL(".", import.meta.url));

let project: string;

const write = (file: string, content: string) => {
  mkdirSync(dirname(join(project, file)), { recursive: true });
  writeFileSync(join(project, file), content);
};

/** Runs `sauf <args>` in the project; resolves with the exit code and the output, without colors. */
const sauf = (...args: string[]) => new Promise<{ code: number | null; output: string }>((resolve) => {
  const child = spawn(process.execPath, [saufBin, ...args], {
    cwd: project,
    env: { ...process.env, NODE_ENV: "development", NO_COLOR: "1", FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  child.on("close", (code) => resolve({ code, output: output.replace(/\x1b\[[0-9;]*m/g, "") }));
});

beforeAll(() => {
  if (!existsSync(saufBin)) throw new Error(`${saufBin} not found: run \`bun run build\` before this test.`);
  // Inside the repo, so the project resolves the workspace packages
  project = mkdtempSync(join(here, ".command-"));
  write("package.json", JSON.stringify({ name: "console-command-fixture", version: "0.0.0", type: "module" }));
  write("app/config/config.ts", "export default { name: 'fixture' };\n");
  write("app/config/providers.ts", "export default [];\n");
  write("app/config/auth.ts", "export default { default: { guard: 'web' }, guards: {} };\n");
  write(
    "app/src/services/GreetingService.ts",
    `export default class GreetingService {
  greet(name: string) { return \`Hello \${name}, from GreetingService\`; }
}
`,
  );
  write("app/src/console/commands/SendMail.ts", `
import { Command } from "@laratype/console";
import GreetingService from "../../services/GreetingService";

export default class SendMail extends Command<typeof SendMail.signature> {
  static readonly signature = "send:mail {user} {--queue=}" as const;
  static description = "Send a test email";

  constructor(private readonly greeting: GreetingService) {
    super();
  }

  public async handle() {
    const queue = this.option("queue");
    console.log(\`[send:mail] \${this.greeting.greet(this.argument("user"))}\${queue ? \` (queue \${queue})\` : ""}\`);
  }
}
`);
  write("app/routes/console.ts", `
import { command } from "@laratype/console";

export default [
  command("hello:user {user} {--shout}", ({ user, shout }) => {
    console.log(\`[hello:user] \${shout ? \`HELLO \${user.toUpperCase()}\` : \`Hello \${user}\`}\`);
  }),
];
`);
});

afterAll(() => {
  if (project) rmSync(project, { recursive: true, force: true });
});

describe("app commands", () => {
  it("resolves a command with constructor DI and fills its typed argument and option", async () => {
    const { code, output } = await sauf("send:mail", "Alice", "--queue=high");
    expect(code, output).toBe(0);
    expect(output).toContain("[send:mail] Hello Alice, from GreetingService (queue high)");
  }, 120_000);

  it("runs a closure command from app/routes/console.ts with its typed input", async () => {
    const [hello, shout] = await Promise.all([sauf("hello:user", "Bob"), sauf("hello:user", "Bob", "--shout")]);
    expect(hello.code, hello.output).toBe(0);
    expect(hello.output).toContain("[hello:user] Hello Bob");
    expect(shout.code, shout.output).toBe(0);
    expect(shout.output).toContain("[hello:user] HELLO BOB");
  }, 120_000);

  it("make:command writes the v1 stub with the signature derived from the class name", async () => {
    const { code, output } = await sauf("make:command", "CleanCache");
    expect(code, output).toBe(0);
    const file = join(project, "app/console/commands/CleanCache.ts");
    expect(existsSync(file), output).toBe(true);
    const stub = readFileSync(file, "utf-8");
    expect(stub).toContain('extends Command<typeof CleanCache.signature>');
    expect(stub).toContain('static readonly signature = "clean:cache" as const');
  }, 120_000);
});
