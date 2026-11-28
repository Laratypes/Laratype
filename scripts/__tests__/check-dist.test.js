// @ts-check
// B25 #329: the build-root scan behind `bun run check:dist`, and the `bun.build.js` rewrite of the
// `file://` URLs Bun folds `import.meta.url` into. The fixtures hold a Windows-style build root in
// every form a dist can carry, so the test runs the same on Windows and POSIX and never builds.
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CJS_MODULE_URL,
  buildRootForms,
  findBuildRoot,
  findBuildRootInTree,
  keepRuntimeModuleUrl,
} from "../module-paths.mjs";

const ROOT = "C:\\build\\machine\\laratype";
/** A root with a space, so `pathToFileURL` percent-encodes it (`%20`); the native form differs per platform. */
const SPACE_ROOT = process.platform === "win32" ? "C:\\build\\my dir\\laratype" : "/build/my dir/laratype";
const SPACE_URL = pathToFileURL(SPACE_ROOT).href;
const FIXTURES = fileURLToPath(new URL("./fixtures/dist-paths", import.meta.url));

/** @param {string} file */
const fixture = (file) => readFileSync(fileURLToPath(new URL(`./fixtures/dist-paths/${file}`, import.meta.url)), "utf8");

/**
 * Windows `pathToFileURL` for the drive and UNC shapes these tests use, injected so Windows semantics
 * run on POSIX too. `pathToFileURL` itself follows the platform it runs on.
 * @param {string} value
 */
const windowsFileURL = (value) =>
  new URL(value.startsWith("\\\\") ? `file://${value.slice(2).replace(/\\/g, "/")}` : `file:///${value.replace(/\\/g, "/")}`);

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

  it("adds the percent-encoded URL for a root with a space", () => {
    const forms = buildRootForms(SPACE_ROOT);

    expect(SPACE_URL).toContain("%20");
    expect(forms).toContain(SPACE_URL);
    // Bun only percent-encodes the URL, so the plain form stays a form as well.
    expect(forms).toContain(SPACE_URL.replace("%20", " "));
  });
});

describe("buildRootForms pathToFileURL", () => {
  it("builds a UNC root's URL the way pathToFileURL does, not by concatenation", () => {
    const forms = buildRootForms(String.raw`\\server\share\repo`, { pathApi: path.win32, toFileURL: windowsFileURL });

    expect(forms).toContain("file://server/share/repo");
    expect(forms).not.toContain("file:////server/share/repo");
  });

  it("builds a drive root's URL with the injected Windows semantics", () => {
    const forms = buildRootForms(String.raw`C:\b\repo`, { pathApi: path.win32, toFileURL: windowsFileURL });

    expect(forms).toContain("file:///C:/b/repo");
  });

  // pathToFileURL resolves for the platform it runs on, and a UNC root is not absolute on POSIX, so this
  // native assertion runs on Windows only; the injected Windows semantics above cover the form elsewhere.
  it.skipIf(process.platform !== "win32")("uses the native pathToFileURL for a UNC root on Windows", () => {
    const unc = String.raw`\\server\share\repo`;

    expect(buildRootForms(unc)).toContain(pathToFileURL(unc).href);
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
    const hit = findBuildRoot(`${prefix}"C:/build/machine/laratype/x"`, ROOT);

    // indexOf counts UTF-16 code units: the surrogate pair is 2, and the quote before the path is 1.
    expect(hit?.index).toBe(prefix.length + 1);
  });

  it("ignores a clean file", () => {
    expect(findBuildRoot(fixture("clean/output/index.js"), ROOT)).toBeUndefined();
  });

  it("matches case-insensitively only when asked", () => {
    const contents = fixture("case/output/index.js");

    expect(findBuildRoot(contents, ROOT)).toBeUndefined();
    expect(findBuildRoot(contents, ROOT, { caseInsensitive: true })?.form).toBe("file:///C:/build/machine/laratype");
  });

  it("finds the percent-encoded URL of a root with a space", () => {
    const contents = `const manifest = new URL("./app.manifest.js", "${SPACE_URL}/packages/sauf/src/manifest/load.ts").href;`;
    const hit = findBuildRoot(contents, SPACE_ROOT);

    expect(hit?.form).toBe(SPACE_URL);
    expect(hit?.index).toBe(contents.indexOf(SPACE_URL));
  });
});

describe("path boundaries", () => {
  const root = "C:/b/laratype";

  it("does not take a segment suffix for the root", () => {
    // `/app` is a common root in a container; `resources/app/x` is not under it.
    expect(findBuildRoot('const a = "resources/app/x";', "/app")).toBeUndefined();
  });

  it("finds a root after any non-path character", () => {
    for (const before of ["(", "=", ":", ",", "[", ";"]) {
      const contents = `${before}${root}`;
      expect(findBuildRoot(contents, root), before).toBeDefined();
      expect(findBuildRoot(contents, root)?.index, before).toBe(1);
    }
  });

  it("still rejects a path character before the root", () => {
    expect(findBuildRoot(`x${root}`, root)).toBeUndefined();
    expect(findBuildRoot('"resources/app/x"', "/app")).toBeUndefined();
  });

  it("keeps searching after a rejected segment suffix", () => {
    const contents = 'const a = "resources/app/x";\nconst b = "/app/y";\n';
    const hit = findBuildRoot(contents, "/app");

    expect(hit?.form).toBe("/app");
    expect(hit?.index).toBe(contents.lastIndexOf("/app"));
  });

  it("does not take a sibling directory for the root", () => {
    expect(findBuildRoot(`const a = "${root}-fork/x";`, root)).toBeUndefined();
    expect(keepRuntimeModuleUrl(`const a = "file:///C:/b/laratype-fork/x";`, root).rewritten).toBe(0);
  });

  it("takes a root followed by a separator, a quote or the end", () => {
    expect(findBuildRoot(`${root}/x`, root)?.index).toBe(0);
    expect(findBuildRoot(`"${root}"`, root)?.index).toBe(1);
    expect(findBuildRoot(root, root)?.index).toBe(0);
  });

  it("rewrites a literal that ends at the root and leaves a sibling literal", () => {
    const hit = keepRuntimeModuleUrl(`const a = "file:///C:/b/laratype";`, root);

    expect(hit.rewritten).toBe(1);
    expect(hit.code).toContain(CJS_MODULE_URL);
    expect(hit.code).not.toContain("C:/b/laratype");
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

  it("rewrites both URL forms of a root with a space", () => {
    const plain = SPACE_URL.replace("%20", " ");
    const contents = `const a = "${plain}/a";\nconst b = "${SPACE_URL}/b";\n`;
    const { code, rewritten } = keepRuntimeModuleUrl(contents, SPACE_ROOT);

    expect(rewritten).toBe(2);
    expect(code).not.toContain("my dir");
    expect(code).not.toContain("my%20dir");
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

describe("real paths", () => {
  /** @type {string} */
  let target;
  /** @type {string} */
  let link;

  beforeAll(() => {
    target = mkdtempSync(path.join(tmpdir(), "laratype-real-"));
    link = `${target}-link`;
    // A junction needs no privilege on Windows; a directory symlink is the POSIX equivalent.
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  });

  afterAll(() => {
    rmSync(link, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });

  it("covers the real path's forms and rewrites a literal under it", () => {
    const real = realpathSync.native(link);

    expect(real).not.toBe(link);
    expect(buildRootForms([link, real])).toEqual(expect.arrayContaining(buildRootForms(real)));

    const url = buildRootForms(real).find(form => form.startsWith("file://"));
    expect(url).toBeDefined();
    const contents = `const a = "${url}/x";`;
    expect(findBuildRoot(contents, [link, real])?.form).toBe(url);

    const { code, rewritten } = keepRuntimeModuleUrl(contents, [link, real]);
    expect(rewritten).toBe(1);
    expect(code).toContain(CJS_MODULE_URL);
  });
});
