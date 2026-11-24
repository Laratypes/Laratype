// @ts-check
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const CLI = "scripts/release/cli.js";
/** @type {string[]} */
const roots = [];

/**
 * A minimal release tree with the real CLI copied in. The CLI's ROOT is derived from its own path, so this
 * exercises the same entry point the npm scripts and the workflow use.
 * @param {{ version?: string, pre?: boolean, base?: string }} [options]
 * @returns {string}
 */
function makeTree({ version = "0.5.4", pre = true, base = "1.0.0" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "laratype-release-cli-"));
  roots.push(root);
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ version, private: true }, null, 2)}\n`);
  /** @type {Array<[string, string, boolean]>} */
  const packageEntries = [
    ["http", "@laratype/http", false],
    ["sauf", "sauf", false],
    ["empty", "@laratype/empty", true],
  ];
  for (const [dir, name, isPrivate] of packageEntries) {
    const pkgDir = path.join(root, "packages", dir);
    mkdirSync(pkgDir, { recursive: true });
    const pkg = { name, version, ...(isPrivate ? { private: true } : {}) };
    writeFileSync(path.join(pkgDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    if (!isPrivate) mkdirSync(path.join(pkgDir, "src"));
  }
  cpSync(path.join(process.cwd(), "scripts/release"), path.join(root, "scripts/release"), { recursive: true });
  if (pre) {
    mkdirSync(path.join(root, ".changeset"), { recursive: true });
    writeFileSync(
      path.join(root, ".changeset", "pre.json"),
      `${JSON.stringify({ mode: "pre", tag: "alpha", base }, null, 2)}\n`,
    );
  }
  return root;
}

/**
 * @param {string} root
 * @param {...string} args
 */
function run(root, ...args) {
  return spawnSync(process.execPath, [path.join(root, CLI), ...args], { cwd: root, encoding: "utf8" });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("cli", () => {
  it("checks a valid tree and rejects an expected-version mismatch", () => {
    const root = makeTree({ version: "1.0.0-alpha.0" });
    const ok = run(root, "check");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("release: ok, version 1.0.0-alpha.0, dist-tag alpha");

    const bad = run(root, "check", "--version", "9.9.9");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("not the expected 9.9.9");
  });

  it("rejects a stable publish while pre.json is still configured", () => {
    const root = makeTree({ version: "1.0.0", base: "1.1.0" });
    expect(run(root, "check").status).toBe(0);
    const publish = run(root, "check", "--publish");
    expect(publish.status).toBe(1);
    expect(publish.stderr).toContain("run release:pre-exit before a stable publish");

    const stable = makeTree({ version: "1.0.0", pre: false });
    expect(run(stable, "check", "--publish").status).toBe(0);
  });

  it("writes a changeset and runs the release end to end", () => {
    const root = makeTree();
    const changeset = run(root, "changeset", "@laratype/http", "minor", "Fix the thing.");
    expect(changeset.status).toBe(0);
    expect(changeset.stdout).toContain("release: wrote .changeset");

    const version = run(root, "version");
    expect(version.status).toBe(0);
    expect(version.stdout).toContain("0.5.4 -> 1.0.0-alpha.0");
    expect(JSON.parse(readFileSync(path.join(root, "packages/http/package.json"), "utf8")).version).toBe(
      "1.0.0-alpha.0",
    );
    expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version).toBe("1.0.0-alpha.0");
    expect(readFileSync(path.join(root, "CHANGELOG.md"), "utf8")).toContain("Fix the thing.");
    expect(run(root, "version").stdout).toContain("nothing to release");
  });

  it("never lets a user-supplied package name become a path", () => {
    const root = makeTree();
    const result = run(root, "changeset", "../../evil", "minor", "x");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown package");
    expect(run(root, "changeset", "@laratype/empty", "minor", "x").status).toBe(1);
    expect(run(root, "changeset", "@laratype/http", "minor").status).toBe(1);
  });

  it("maps dist-tags and rejects another prerelease id", () => {
    const root = makeTree();
    expect(run(root, "dist-tag", "1.0.0-alpha.0").stdout.trim()).toBe("alpha");
    expect(run(root, "dist-tag", "1.0.0").stdout.trim()).toBe("latest");
    const beta = run(root, "dist-tag", "1.0.0-beta.0");
    expect(beta.status).toBe(1);
    expect(beta.stderr).toContain("only configured prerelease dist-tag is alpha");
  });

  it("rejects unknown commands, missing arguments and extra arguments without writing", () => {
    const root = makeTree();
    const unknown = run(root, "nope");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('unknown command "nope"');
    expect(run(root, "pre").status).toBe(1);
    expect(run(root, "version", "extra").status).toBe(1);
    expect(run(makeTree({ pre: false }), "pre-exit").status).toBe(1);
    expect(run(root, ".changeset", "x.md", "minor", "x").status).toBe(1);
  });

  it("enters and leaves pre mode through the CLI", () => {
    const root = makeTree({ version: "1.0.0", pre: false });
    expect(run(root, "pre", "1.1.0").status).toBe(0);
    expect(run(root, "pre", "1.2.0").status).toBe(1);
    expect(run(root, "pre-exit").status).toBe(0);
    expect(run(root, "pre-exit").status).toBe(1);
  });
});
