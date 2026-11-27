// @ts-check
// B25 #329: the build-root scan behind `bun run check:dist`, and the `bun.build.js` rewrite of the
// `file://` URLs Bun folds `import.meta.url` into. The fixtures hold a Windows-style build root in
// every form a dist can carry, so the test runs the same on Windows and POSIX and never builds.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CJS_MODULE_URL,
  buildRootForms,
  findBuildRoot,
  findBuildRootInTree,
  keepRuntimeModuleUrl,
} from "../module-paths.mjs";

const ROOT = "C:\\build\\machine\\laratype";
const FIXTURES = fileURLToPath(new URL("./fixtures/dist-paths", import.meta.url));

/** @param {string} file */
const fixture = (file) => readFileSync(fileURLToPath(new URL(`./fixtures/dist-paths/${file}`, import.meta.url)), "utf8");

describe("buildRootForms", () => {
  it("lists the URL, forward-slash, backslash and escaped-backslash forms", () => {
    expect(buildRootForms(ROOT)).toEqual([
      "file:///C:/build/machine/laratype",
      "C:/build/machine/laratype",
      "C:\\build\\machine\\laratype",
      "C:\\\\build\\\\machine\\\\laratype",
    ]);
  });

  it("builds the same forms from a root that already uses forward slashes", () => {
    expect(buildRootForms("C:/build/machine/laratype")).toEqual(buildRootForms(ROOT));
  });

  it("drops a trailing separator, so a root with one is reported alike", () => {
    expect(buildRootForms(`${ROOT}\\`)).toContain("C:/build/machine/laratype");
    expect(buildRootForms(`${ROOT}/`)).toEqual(buildRootForms(ROOT));
  });
});

describe("findBuildRoot", () => {
  it("finds a path written with forward slashes", () => {
    const contents = fixture("forward/output/index.js");
    const hit = findBuildRoot(contents, ROOT);

    expect(hit?.form).toBe("C:/build/machine/laratype");
    expect(hit?.index).toBe(contents.indexOf("C:/build/machine/laratype"));
  });

  it("finds a path written with backslashes", () => {
    const contents = fixture("backslash/output/index.js");
    const hit = findBuildRoot(contents, ROOT);

    expect(hit?.form).toBe("C:\\build\\machine\\laratype");
    expect(hit?.index).toBe(contents.indexOf("C:\\build\\machine\\laratype"));
  });

  it("finds the doubled backslashes of a JS string literal", () => {
    const contents = fixture("escaped/output/index.cjs");
    const hit = findBuildRoot(contents, ROOT);

    expect(hit?.form).toBe("C:\\\\build\\\\machine\\\\laratype");
    expect(hit?.index).toBe(contents.indexOf("C:\\\\build\\\\machine\\\\laratype"));
  });

  it("reports a file:// URL at its file:// offset", () => {
    const contents = fixture("url/output/index.cjs");
    const hit = findBuildRoot(contents, ROOT);

    // The forward-slash form also occurs inside the URL, 8 characters later.
    expect(hit?.form).toBe("file:///C:/build/machine/laratype");
    expect(hit?.index).toBe(contents.indexOf("file:///"));
  });

  it("returns the first offset when a file carries the root twice", () => {
    const contents = fixture("first/output/index.js");
    const hit = findBuildRoot(contents, ROOT);

    expect(hit?.index).toBe(contents.indexOf("C:\\\\build\\\\machine\\\\laratype"));
  });

  it("returns nothing for empty contents", () => {
    expect(findBuildRoot("", ROOT)).toBeUndefined();
  });

  it("reports the offset in JS string units after unicode text", () => {
    const prefix = `${"é".repeat(1_000)}𝄞`;
    const hit = findBuildRoot(`${prefix}C:/build/machine/laratype/x`, ROOT);

    // indexOf counts UTF-16 code units, so the lone surrogate pair is 2.
    expect(hit?.index).toBe(prefix.length);
  });

  it("ignores a clean file", () => {
    expect(findBuildRoot(fixture("clean/output/index.js"), ROOT)).toBeUndefined();
  });

  it("matches case-insensitively only when asked", () => {
    const contents = fixture("case/output/index.js");

    expect(findBuildRoot(contents, ROOT)).toBeUndefined();
    expect(findBuildRoot(contents, ROOT, { caseInsensitive: true })?.form).toBe("file:///C:/build/machine/laratype");
  });
});

describe("findBuildRootInTree", () => {
  it("reports every offending file under a directory, nested ones included", () => {
    const hits = findBuildRootInTree(FIXTURES, ROOT);
    const files = hits.map(({ file }) => file.replace(FIXTURES, "").replace(/\\/g, "/")).sort();

    expect(files).toEqual([
      "/backslash/output/index.js",
      "/escaped/output/index.cjs",
      "/first/output/index.js",
      "/forward/output/index.js",
      "/nested/output/chunks/chunk-abc.js",
      "/url/output/index.cjs",
    ]);
  });

  it("finds the upper-case fixture when the scan is case-insensitive", () => {
    const hits = findBuildRootInTree(FIXTURES, ROOT, { caseInsensitive: true });
    const files = hits.map(({ file }) => file.replace(FIXTURES, "").replace(/\\/g, "/"));

    expect(files).toContain("/case/output/index.js");
  });
});

describe("keepRuntimeModuleUrl", () => {
  it("rewrites a folded file:// literal to the bundle's own URL", () => {
    const contents = fixture("url/output/index.cjs");
    const { code, rewritten } = keepRuntimeModuleUrl(contents, ROOT);

    expect(rewritten).toBe(1);
    expect(code).toContain(CJS_MODULE_URL);
    expect(code).not.toContain("file:///C:/build/machine/laratype");
  });

  it("rewrites every literal in the file", () => {
    const contents = 'const a = "file:///C:/build/machine/laratype/a";\nconst b = "file:///C:/build/machine/laratype/b";\n';
    const { code, rewritten } = keepRuntimeModuleUrl(contents, ROOT);

    expect(rewritten).toBe(2);
    expect(code.match(/pathToFileURL\(__filename\)/g)).toHaveLength(2);
  });

  it("rewrites a single-quoted literal too", () => {
    const { code, rewritten } = keepRuntimeModuleUrl("const url = 'file:///C:/build/machine/laratype/x';\n", ROOT);

    expect(rewritten).toBe(1);
    expect(code).toBe(`const url = ${CJS_MODULE_URL};\n`);
  });

  it("leaves a URL outside a string literal for check:dist to report", () => {
    const contents = "// file:///C:/build/machine/laratype/packages/sauf/src/index.ts\n";
    const { code, rewritten } = keepRuntimeModuleUrl(contents, ROOT);

    expect(rewritten).toBe(0);
    expect(code).toBe(contents);
  });

  it("leaves a URL in a template literal unchanged", () => {
    const contents = "const url = `file:///C:/build/machine/laratype/${name}`;\n";
    const { code, rewritten } = keepRuntimeModuleUrl(contents, ROOT);

    expect(rewritten).toBe(0);
    expect(code).toBe(contents);
  });

  it("leaves code without the build root untouched", () => {
    const contents = fixture("clean/output/index.js");
    const { code, rewritten } = keepRuntimeModuleUrl(contents, ROOT);

    expect(rewritten).toBe(0);
    expect(code).toBe(contents);
  });
});
