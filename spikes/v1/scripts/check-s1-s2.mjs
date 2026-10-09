// Reproduces every S1 (#84) and S2 (#85) check. Run from anywhere: `node spikes/v1/scripts/check-s1-s2.mjs`.
// Needs Node >= 22, the spikes/v1/node_modules junction (zod, @swc/core), and typescript/esbuild in the repo root
// node_modules (`bun install`). Overrides: TS_PATH, ESBUILD_PATH.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // spikes/v1
const repo = resolve(root, "../..");
const require = createRequire(join(root, "package.json"));
const tsPath = process.env.TS_PATH ?? join(repo, "node_modules/typescript");
const ts = require(tsPath);
const tscBin = join(tsPath, "bin/tsc");

let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) failed++;
};
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
  return { code: r.status, out: (r.stdout + r.stderr).replace(/\r\n/g, "\n").trim() };
};
const tsc = (...args) => run(process.execPath, [tscBin, ...args]);

console.log(`typescript ${ts.version}, node ${process.version}\n`);

// ---- S1 ---------------------------------------------------------------------
console.log("S1 controller typing");
{
  const r = tsc("-p", "tsconfig.json", "--pretty", "false");
  check(r.code === 0, "tsc -p spikes/v1: positive cases + every @ts-expect-error in s1-controller/tests/type-tests.ts", r.out);

  const e = tsc("-p", "s1-controller/tests/tsconfig.errors.json", "--pretty", "false");
  writeFileSync(join(root, "s1-controller/tsc-errors.txt"), `$ tsc -p s1-controller/tests/tsconfig.errors.json --pretty false   (typescript ${ts.version})\n\n${e.out}\n`);
  const expectIn = [
    ["[b1] no auth(): names endpoint + missing key", "(15,", "users.destroy: handler requires `user`, route does not provide it"],
    ["[b2] no .bind(): names endpoints + param", "(18,", "users.show: `params.user` provided by the route does not match the handler"],
    ["[b2] ... and shows provided vs required type", "(18,", "route_provides: string; handler_requires: User"],
    ["[a1] Option A wrong return reported at r.contract()", "(30,", "users.show: return type does not match the response schema"],
    ["[a2] Option B wrong return reported at the handler", "(35,", "Property 'email' is missing"],
    ["[e1] exhaustiveness", "(44,", "users.store: controller has no handler for this endpoint"],
    ["[e1] bind key not a path param", "(44,", ".bind(): `usr` is not a path param of any endpoint in users"],
  ];
  check(e.code !== 0, "errors.fixture.ts fails to compile (raw output saved to s1-controller/tsc-errors.txt)");
  const blocks = e.out.split(/\n(?=s1-controller\/)/);
  for (const [label, loc, needle] of expectIn) check(blocks.some((b) => b.includes(loc) && b.includes(needle)), label, `expects ${loc} … ${needle}`);

  // constructor DI x class fields: SWC with sauf's warmup.ts options, and tsc with useDefineForClassFields on/off
  const swc = require("@swc/core");
  const src = readFileSync(join(root, "s1-controller/runtime/di-interplay.ts"), "utf8");
  const out = join(root, "out/s1");
  mkdirSync(out, { recursive: true });
  const emits = {
    swc: swc.transformSync(src, {
      filename: "di-interplay.ts",
      module: { type: "es6" },
      jsc: { target: "es2022", parser: { syntax: "typescript", decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } },
    }).code,
    "tsc useDefineForClassFields=true": ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: true } }).outputText,
    "tsc useDefineForClassFields=false": ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: false } }).outputText,
  };
  const results = {};
  for (const [name, code] of Object.entries(emits)) {
    const file = join(out, `${name.replace(/[^\w]+/g, "-")}.mjs`);
    writeFileSync(file, code);
    const r = run(process.execPath, [file]);
    results[name] = JSON.parse(r.out);
  }
  writeFileSync(join(out, "di-interplay.json"), JSON.stringify(results, null, 2));
  for (const [name, r] of Object.entries(results)) {
    check(r["A: instance.show(ctx)"].includes("Ada") && r["B: instance.show(ctx)"].includes("Ada"), `${name}: A and B handlers reach the injected repo`);
    check(r["A: detached show(ctx)"].startsWith("throws") && !r["B: detached show(ctx)"].startsWith("throws"), `${name}: detached call throws for A (this), works for B (arrow)`);
    check(r["B child override + own ctor dep"].includes("child!"), `${name}: subclass with own ctor dep + field override`);
  }
  check(
    results.swc["B eager field reads this.repo"].startsWith("throws") && results["tsc useDefineForClassFields=true"]["B eager field reads this.repo"].startsWith("throws"),
    "eager field initializer reading an injected dep throws under SWC and tsc(useDefineForClassFields=true)",
    `swc: ${results.swc["B eager field reads this.repo"]}; tsc(false): ${results["tsc useDefineForClassFields=false"]["B eager field reads this.repo"]}`,
  );
}

// ---- S2 ---------------------------------------------------------------------
console.log("\nS2 FE API surface");
{
  const g = run(process.execPath, ["s2-api/scripts/gen.mjs"]);
  check(g.code === 0, "generate slim manifest + separate-repo api.ts (TS checker only, no runtime import)", g.out);

  for (const [p, label] of [
    ["s2-api/fe/tsconfig.json", "monorepo FE (types: [], DOM): options a/b/c + fe/src/type-tests.ts"],
    ["s2-api/fe-separate/tsconfig.json", "separate-repo FE: generated types only"],
    ["s2-api/bench/tsconfig.json", "zod 4 / v4-mini contract copies give identical client types"],
    ["s2-api/fe-bad/tsconfig.json", "anti-pattern fixture (typeof routes) still compiles"],
  ]) {
    const r = tsc("-p", p, "--pretty", "false");
    check(r.code === 0, `tsc -p ${p}: ${label}`, r.out);
  }

  const classify = (f) => {
    const n = f.replace(/\\/g, "/");
    if (/\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(n)) return "typescript lib (ES2022 + DOM)";
    if (/\/node_modules\/(\.bun\/[^/]+\/node_modules\/)?zod\//.test(n)) return "schema lib (zod .d.cts)";
    const rel = n.slice(n.indexOf("/spikes/v1/") + "/spikes/v1/".length);
    if (rel.startsWith("contract/")) return "contract lib (spikes/v1/contract)";
    if (rel.startsWith("s2-api/app/contracts/")) return "app contracts (s2-api/app/contracts)";
    if (rel.startsWith("s2-api/client/")) return "client lib (s2-api/client)";
    if (/^s2-api\/fe[^/]*\/(src|generated)\//.test(rel)) return "FE own code / generated";
    if (rel.startsWith("s1-controller/")) return "SERVER: " + rel;
    return "OTHER: " + rel;
  };
  const listing = {};
  for (const p of ["s2-api/fe/tsconfig.json", "s2-api/fe-separate/tsconfig.json", "s2-api/fe-bad/tsconfig.json"]) {
    const r = tsc("-p", p, "--listFilesOnly");
    const groups = {};
    for (const f of r.out.split("\n").filter(Boolean)) {
      const g = classify(f);
      (groups[g] ??= []).push(f);
    }
    listing[p] = Object.fromEntries(Object.entries(groups).map(([g, fs]) => [g, fs.length]));
  }
  writeFileSync(join(root, "out/s2-listFilesOnly.json"), JSON.stringify(listing, null, 2));
  const allowed = new Set(["typescript lib (ES2022 + DOM)", "schema lib (zod .d.cts)", "contract lib (spikes/v1/contract)", "app contracts (s2-api/app/contracts)", "client lib (s2-api/client)", "FE own code / generated"]);
  const show = (p) => Object.entries(listing[p]).map(([g, n]) => `${n} × ${g}`).join("; ");
  check(Object.keys(listing["s2-api/fe/tsconfig.json"]).every((g) => allowed.has(g)), "monorepo FE --listFilesOnly: only contracts + contract lib + schema lib (+ TS libs, client, own code)", show("s2-api/fe/tsconfig.json"));
  check(
    Object.keys(listing["s2-api/fe-separate/tsconfig.json"]).every((g) => ["typescript lib (ES2022 + DOM)", "client lib (s2-api/client)", "FE own code / generated"].includes(g)),
    "separate-repo FE --listFilesOnly: no contracts, no contract lib, no zod",
    show("s2-api/fe-separate/tsconfig.json"),
  );
  check(Object.keys(listing["s2-api/fe-bad/tsconfig.json"]).some((g) => g.startsWith("SERVER:")), "anti-pattern: `import type` of routes drags server files into the FE program", show("s2-api/fe-bad/tsconfig.json"));

  const b = run(process.execPath, ["s2-api/scripts/bundle-sizes.mjs"]);
  check(b.code === 0, "bundle sizes (esbuild, minify, gzip -9, brotli 11)", b.code === 0 ? "" : b.out);
  if (b.code === 0) console.log("\n" + b.out);
}

console.log(`\n${failed ? `${failed} check(s) FAILED` : "all checks passed"}`);
process.exit(failed ? 1 : 0);
