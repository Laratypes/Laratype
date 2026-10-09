// FE bundle sizes for the S2 client options. esbuild (bundle + minify, browser, ES2022, ESM), then gzip -9 and brotli.
// Usage (from spikes/v1): node s2-api/scripts/bundle-sizes.mjs [--json]   ESBUILD_PATH overrides the esbuild location.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const s2 = resolve(here, "..");
const require = createRequire(import.meta.url);
const esbuild = require(process.env.ESBUILD_PATH ?? resolve(here, "../../../../node_modules/esbuild"));

const contracts = {
  zod3: join(s2, "app/contracts/index.ts"),
  zod4: join(s2, "bench/contracts-zod4/index.ts"),
  "zod4-mini": join(s2, "bench/contracts-zod4-mini/index.ts"),
};
// The contracts are written with `import * as z`. `named: true` rewrites them to `import { z }` on load:
// `z` is then one namespace object, which defeats tree-shaking (worst with zod/v4 classic).
const cases = [
  { name: "(a) createClient(appApi), zod 3 `import * as z`", entry: "fe/src/a.ts", contracts: "zod3" },
  { name: "(a) createClient(appApi), zod 3 `import { z }`", entry: "fe/src/a.ts", contracts: "zod3", named: true },
  { name: "(a) createClient(appApi), zod/v4 classic `import * as z`", entry: "fe/src/a.ts", contracts: "zod4" },
  { name: "(a) createClient(appApi), zod/v4 classic `import { z }`", entry: "fe/src/a.ts", contracts: "zod4", named: true },
  { name: "(a) createClient(appApi), zod/v4-mini", entry: "fe/src/a.ts", contracts: "zod4-mini" },
  { name: "(b) path-style, type-only", entry: "fe/src/b.ts", contracts: "zod3" },
  { name: "(c) slim manifest (monorepo)", entry: "fe/src/c.ts", contracts: "zod3" },
  { name: "(c) separate repo (generated api.ts, manifest + path client)", entry: "fe-separate/src/main.ts", contracts: "zod3" },
];

const alias = (target, named) => ({
  name: "app-contracts",
  setup(b) {
    b.onResolve({ filter: /^@app\/contracts$/ }, () => ({ path: target }));
    if (named)
      b.onLoad({ filter: /[\\/](contracts|contracts-zod4)[\\/]\w+\.ts$/ }, (args) => ({
        contents: readFileSync(args.path, "utf8").replace(/import \* as z from ("zod(?:\/v4)?");/, "import { z } from $1;"),
        loader: "ts",
      }));
  },
});

const outDir = resolve(s2, "../out/s2");
mkdirSync(outDir, { recursive: true });
const rows = [];
for (const [i, c] of cases.entries()) {
  const outfile = join(outDir, `bundle-${i}.js`);
  await esbuild.build({
    entryPoints: [join(s2, c.entry)],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile,
    logLevel: "error",
    plugins: [alias(contracts[c.contracts], c.named)],
  });
  const code = readFileSync(outfile);
  rows.push({
    case: c.name,
    min: code.length,
    gzip: gzipSync(code, { level: 9 }).length,
    brotli: brotliCompressSync(code, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    schemaRuntime: code.includes("~standard"),
  });
}

if (process.argv.includes("--json")) console.log(JSON.stringify(rows));
else {
  const kb = (n) => `${(n / 1024).toFixed(2)} KiB`;
  console.log("| Case | min | min+gzip | min+brotli | schema runtime in bundle |\n|---|---:|---:|---:|---|");
  for (const r of rows) console.log(`| ${r.case} | ${kb(r.min)} | ${kb(r.gzip)} | ${kb(r.brotli)} | ${r.schemaRuntime ? "yes" : "no"} |`);
}
