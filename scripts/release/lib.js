// @ts-check
// Release-line helpers for the dependency-free versioner (B15 #190, docs/v1/build.md › CI and release).
//
// The repo keeps one fixed version for every package, so a changeset names a package only to pick the bump
// level and to place the note in the changelog. The versioner does local file I/O only: it never reads the
// network and never rewrites `workspace:*` / `catalog:` ranges (bun resolves both when packing).
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const CHANGELOG_FILE = "CHANGELOG.md";
const CHANGESET_DIR = ".changeset";
const PRE_FILE = "pre.json";
export const MAX_SUMMARY_LENGTH = 2000;
const BUMPS = /** @type {const} */ (["patch", "minor", "major"]);
/** @typedef {'patch' | 'minor' | 'major'} Bump */
/** @type {Set<string>} */
const BUMP_LEVELS = new Set(BUMPS);

/**
 * @param {unknown} value
 * @returns {value is Bump}
 */
function isBump(value) {
  return typeof value === "string" && BUMP_LEVELS.has(value);
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// NUL..BS, VT, FF, CR..US, DEL. LF and TAB stay allowed; CRLF is normalized before validation.
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ALPHA = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An expected, user-facing failure: the CLI prints the message and exits 1. */
export class ReleaseError extends Error {}

/**
 * @param {string} message
 * @returns {never}
 */
const fail = (message) => {
  throw new ReleaseError(message);
};

/**
 * @param {string} file
 * @returns {Record<string, unknown>}
 */
function readJson(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${file}: invalid JSON (${/** @type {Error} */ (error).message})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${file}: expected a JSON object`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isVersion(value) {
  return typeof value === "string" && SEMVER.test(value);
}

/**
 * @param {string} version
 * @returns {string}
 */
function stableVersion(version) {
  if (!isVersion(version)) fail(`invalid semver version "${version}"`);
  return version.split("-")[0];
}

/**
 * Compare two stable versions by their numeric parts. Prereleases are not compared.
 * @param {string} left
 * @param {string} right
 * @returns {number} -1, 0 or 1
 */
function compareStable(left, right) {
  const a = stableVersion(left).split(".").map(Number);
  const b = stableVersion(right).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * The dist-tag a version publishes under. Only `alpha` is a configured prerelease channel; any other
 * prerelease id fails, so a typo can never publish to `latest`.
 * @param {string} version
 * @returns {'alpha' | 'latest'}
 */
export function distTagFor(version) {
  if (!isVersion(version)) fail(`invalid semver version "${version}"`);
  if (!version.includes("-")) return "latest";
  if (ALPHA.test(version)) return "alpha";
  fail(`prerelease "${version}" is not an alpha version: the only configured prerelease dist-tag is alpha`);
}

/**
 * The workspace tree: root package.json plus every packages/* directory with a package.json.
 * @param {string} root
 */
export function readWorkspace(root) {
  const packagesDir = path.join(root, "packages");
  if (!existsSync(packagesDir) || !statSync(packagesDir).isDirectory()) {
    fail(`no packages directory at ${packagesDir}`);
  }

  /** @type {Array<{ dir: string, file: string, name: string, version: string, private: boolean, pkg: Record<string, unknown> }>} */
  const packages = [];
  const names = new Set();

  for (const entry of readdirSync(packagesDir).sort()) {
    const dir = path.join(packagesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const file = path.join(dir, "package.json");
    if (!existsSync(file)) continue;
    const pkg = readJson(file);
    const name = pkg.name;
    if (typeof name !== "string" || name.length === 0) fail(`${file}: "name" must be a non-empty string`);
    const version = pkg.version;
    if (!isVersion(version)) fail(`${file}: "version" must be a semver string, got ${JSON.stringify(pkg.version)}`);
    if (pkg.private !== undefined && typeof pkg.private !== "boolean") {
      fail(`${file}: "private" must be a boolean when present, got ${JSON.stringify(pkg.private)}`);
    }
    if (names.has(name)) fail(`${file}: duplicate package name "${name}"`);
    names.add(name);
    packages.push({
      dir: `packages/${entry}`,
      file,
      name,
      version,
      private: pkg.private === true,
      pkg,
    });
  }

  if (packages.length === 0) fail("no package.json under packages/*");

  const rootFile = path.join(root, "package.json");
  const rootPkg = readJson(rootFile);
  const rootVersion = rootPkg.version;
  if (!isVersion(rootVersion)) {
    fail(`${rootFile}: "version" must be a semver string, got ${JSON.stringify(rootPkg.version)}`);
  }

  return { root, packages, rootPkg, rootVersion, rootFile };
}

/**
 * The fixed version shared by every package and the root. A mismatch is an error before anything is written.
 * @param {ReturnType<typeof readWorkspace>} workspace
 * @returns {string}
 */
export function fixedVersion(workspace) {
  const versions = new Set([...workspace.packages.map((pkg) => pkg.version), workspace.rootVersion]);
  if (versions.size !== 1) {
    fail(`fixed versioning needs one version for every package, found ${[...versions].sort().join(", ")}`);
  }
  return /** @type {string} */ ([...versions][0]);
}

/**
 * @param {ReturnType<typeof readWorkspace>} workspace
 * @returns {Map<string, ReturnType<typeof readWorkspace>['packages'][number]>}
 */
export function publicPackages(workspace) {
  const map = new Map();
  for (const pkg of workspace.packages) {
    if (!pkg.private) map.set(pkg.name, pkg);
  }
  return map;
}

/**
 * @param {string} root
 * @param {{ dir: string }} pkg
 * @returns {boolean}
 */
function packageHasCode(root, pkg) {
  const src = path.join(root, pkg.dir, "src");
  return existsSync(src) && statSync(src).isDirectory();
}

/**
 * @param {string} text
 * @returns {boolean} true when every surrogate is part of a valid pair
 */
function hasOnlyPairedSurrogates(text) {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Validate a changeset summary (the body below the front matter).
 * @param {unknown} summary
 * @returns {string}
 */
export function assertSummary(summary) {
  if (typeof summary !== "string") fail(`summary must be a string, got ${typeof summary}`);
  const value = summary.trim();
  if (value.length === 0) fail("summary must not be empty");
  if (value.length > MAX_SUMMARY_LENGTH) {
    fail(`summary is ${value.length} characters; the limit is ${MAX_SUMMARY_LENGTH}`);
  }
  if (CONTROL_CHARS.test(value)) fail("summary must not contain control characters (LF and TAB are allowed)");
  if (!hasOnlyPairedSurrogates(value)) fail("summary contains an unpaired UTF-16 surrogate");
  return value;
}

/**
 * Parse a changeset file: front matter of `"name": patch|minor|major` lines, then a non-empty summary.
 * CRLF input is normalized to LF (deterministic; the repo stores LF via .gitattributes).
 * @param {unknown} source
 * @param {Map<string, { name: string, private: boolean }>} packages public packages by name
 * @returns {{ releases: Array<{ name: string, bump: 'patch' | 'minor' | 'major' }>, summary: string }}
 */
export function parseChangeset(source, packages) {
  if (typeof source !== "string") fail(`changeset source must be a string, got ${typeof source}`);
  let text = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  if (lines[0] !== "---") fail('changeset must start with a "---" front-matter line');

  let close = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index] === "---") {
      close = index;
      break;
    }
  }
  if (close === -1) fail('changeset front matter has no closing "---" line');

  /** @type {Map<string, { name: string, bump: 'patch' | 'minor' | 'major' }>} */
  const releases = new Map();
  for (const raw of lines.slice(1, close)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const match = /^"?([^"]+?)"?\s*:\s*([A-Za-z]+)\s*$/.exec(line);
    if (!match) fail(`malformed front-matter line "${line}"`);
    const name = match[1].trim();
    const bump = match[2];
    if (FORBIDDEN_KEYS.has(name)) fail(`front-matter package name "${name}" is not allowed`);
    if (!isBump(bump)) {
      fail(`front-matter bump for "${name}" must be one of ${BUMPS.join(", ")}, got "${bump}"`);
    }
    // A Map keeps "__proto__" an ordinary key and makes the duplicate check independent of prototypes.
    if (releases.has(name)) fail(`front matter names "${name}" more than once`);
    const pkg = packages.get(name);
    if (!pkg || pkg.private) fail(`front matter names an unknown or private package "${name}"`);
    releases.set(name, { name, bump });
  }
  if (releases.size === 0) fail("changeset front matter is empty");

  const summary = assertSummary(lines.slice(close + 1).join("\n"));
  return { releases: [...releases.values()], summary };
}

/**
 * Every pending changeset in `.changeset/*.md` (README.md excluded), sorted by file name.
 * @param {string} root
 * @param {Map<string, { name: string, private: boolean }>} packages
 */
export function readChangesets(root, packages) {
  const dir = path.join(root, CHANGESET_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort()
    .map((file) => {
      const full = path.join(dir, file);
      return { file: full, name: file, ...parseChangeset(readFileSync(full, "utf8"), packages) };
    });
}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {string}
 */
function assertStableBase(value, what) {
  if (typeof value !== "string" || !STABLE.test(value)) {
    fail(`${what} must be a stable semver version (X.Y.Z), got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * The pre-release state (`.changeset/pre.json`), or null when the repo is not in pre mode.
 * @param {string} root
 * @returns {{ mode: 'pre', tag: 'alpha', base: string } | null}
 */
export function readPre(root) {
  const file = path.join(root, CHANGESET_DIR, PRE_FILE);
  if (!existsSync(file)) return null;
  const pre = readJson(file);
  if (pre.mode !== "pre") fail(`${file}: "mode" must be "pre"`);
  if (pre.tag !== "alpha") fail(`${file}: "tag" must be "alpha"`);
  return { mode: "pre", tag: "alpha", base: assertStableBase(pre.base, `${file}: "base"`) };
}

/**
 * @param {string} root
 * @param {string} base
 * @returns {string} the written file
 */
export function writePre(root, base) {
  assertStableBase(base, "pre mode base");
  const dir = path.join(root, CHANGESET_DIR);
  const file = path.join(dir, PRE_FILE);
  if (existsSync(file)) fail(`${file} already exists; run release:pre-exit before entering another line`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ mode: "pre", tag: "alpha", base }, null, 2)}\n`);
  return file;
}

/**
 * @param {string} root
 * @returns {string} the removed file
 */
export function removePre(root) {
  const file = path.join(root, CHANGESET_DIR, PRE_FILE);
  if (!existsSync(file)) fail(`${file} does not exist; the repo is not in pre mode`);
  unlinkSync(file);
  return file;
}

/**
 * Highest bump in a release list.
 * @param {Array<{ bump: string }>} releases
 * @returns {'patch' | 'minor' | 'major' | null}
 */
function highestBump(releases) {
  let highest = -1;
  for (const release of releases) {
    const bump = release.bump;
    if (!isBump(bump)) fail(`unknown bump level "${release.bump}"`);
    const index = BUMPS.indexOf(bump);
    if (index > highest) highest = index;
  }
  return highest === -1 ? null : BUMPS[highest];
}

/**
 * @param {string} version stable X.Y.Z
 * @param {'patch' | 'minor' | 'major'} bump
 * @returns {string}
 */
function bumpVersion(version, bump) {
  const [major, minor, patch] = stableVersion(version).split(".").map(Number);
  if (bump === "major") return major === 0 ? "1.0.0" : `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  fail(`unknown bump level "${bump}"`);
}

/**
 * The next fixed version, or null when there is nothing to release.
 *
 * In pre mode the line's `base` is fixed, so a bump level never moves the first v1 release off 1.0.0: any
 * pending changeset increments `alpha.N` (or starts `alpha.0` for a new line). Outside pre mode a stable version
 * applies the highest bump (a major bump on 0.x becomes 1.0.0); a prerelease without pre.json is the exit state and
 * writes the line's stable base.
 * @param {{ current: string, pre: { base: string } | null, releases: Array<{ bump: string }> }} input
 * @returns {string | null}
 */
export function nextVersion({ current, pre, releases }) {
  if (!isVersion(current)) fail(`invalid current version "${current}"`);
  if (!Array.isArray(releases)) fail("releases must be an array");
  const bump = highestBump(releases);
  const currentStable = stableVersion(current);

  if (pre) {
    if (currentStable === pre.base) {
      if (!current.includes("-")) {
        fail(`pre mode targets ${pre.base}, which is already released; run release:pre-exit, then release:pre <next>`);
      }
      const match = ALPHA.exec(current);
      if (!match) fail(`pre mode targets ${pre.base} but ${current} is not an alpha version`);
      return bump === null ? null : `${pre.base}-alpha.${Number(match[4]) + 1}`;
    }
    if (current.includes("-")) {
      fail(`pre mode targets ${pre.base} but the tree is at ${current}; run release:pre-exit first`);
    }
    if (compareStable(pre.base, currentStable) <= 0) {
      fail(`pre mode base ${pre.base} must be greater than the current version ${current}`);
    }
    return bump === null ? null : `${pre.base}-alpha.0`;
  }

  if (current.includes("-")) {
    if (!ALPHA.test(current)) fail(`unsupported prerelease version "${current}"`);
    // `release:pre-exit` was run: the next write is the line's stable base. Pending changesets feed only the
    // stable changelog; their bump levels were already folded into the alpha line and must not move the base.
    return currentStable;
  }
  return bump === null ? null : bumpVersion(current, bump);
}

/**
 * The changelog section for one release.
 * @param {{ version: string, date: string, changesets: Array<{ releases: Array<{ name: string }>, summary: string }> }} input
 * @returns {string}
 */
function renderChangelogEntry({ version, date, changesets }) {
  if (!isVersion(version)) fail(`invalid version "${version}"`);
  if (typeof date !== "string" || !DATE.test(date)) fail(`invalid changelog date "${date}"`);
  /** @type {Map<string, string[]>} */
  const grouped = new Map();
  for (const changeset of changesets) {
    for (const release of changeset.releases) {
      const list = grouped.get(release.name) ?? [];
      list.push(changeset.summary);
      grouped.set(release.name, list);
    }
  }
  const parts = [`## ${version} (${date})`];
  for (const name of [...grouped.keys()].sort()) {
    const summaries = grouped.get(name);
    if (summaries === undefined) continue;
    parts.push(`### ${name}`, summaries.join("\n\n"));
  }
  return `${parts.join("\n\n")}\n`;
}

/**
 * @param {string} existing
 * @param {string} entry
 * @returns {string}
 */
function mergeChangelog(existing, entry) {
  const normalized = existing.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("# Changelog")) fail(`${CHANGELOG_FILE} must start with "# Changelog"`);
  const rest = normalized.slice("# Changelog".length).trim();
  return rest.length === 0 ? `# Changelog\n\n${entry}` : `# Changelog\n\n${entry}\n${rest}\n`;
}

/**
 * Write the fixed version to every package and the root, prepend the changelog section and delete the applied
 * changesets. Every check (including the fixed-version check) runs before the first write.
 * @param {{
 *   root: string,
 *   workspace: ReturnType<typeof readWorkspace>,
 *   version: string,
 *   changesets: ReturnType<typeof readChangesets>,
 *   date: string,
 * }} input
 * @returns {string} the version written
 */
export function writeRelease({ root, workspace, version, changesets, date }) {
  if (!isVersion(version)) fail(`invalid release version "${version}"`);
  const current = fixedVersion(workspace);
  if (current === version) fail(`the tree is already at ${version}`);
  distTagFor(version);

  /** @type {Array<[string, string]>} */
  const writes = [];
  for (const pkg of workspace.packages) {
    writes.push([pkg.file, `${JSON.stringify({ ...pkg.pkg, version }, null, 2)}\n`]);
  }
  writes.push([workspace.rootFile, `${JSON.stringify({ ...workspace.rootPkg, version }, null, 2)}\n`]);

  const changelogFile = path.join(root, CHANGELOG_FILE);
  const existing = existsSync(changelogFile) ? readFileSync(changelogFile, "utf8") : "# Changelog\n\n";
  const updated = mergeChangelog(existing, renderChangelogEntry({ version, date, changesets }));

  for (const [file, content] of writes) writeFileSync(file, content);
  writeFileSync(changelogFile, updated);
  for (const changeset of changesets) unlinkSync(changeset.file);
  return version;
}

/**
 * Validate the tree the release workflow is about to publish.
 * @param {string} root
 * @param {{ expectedVersion?: string, publish?: boolean }} [options]
 * @returns {{ version: string, distTag: 'alpha' | 'latest', pre: ReturnType<typeof readPre> }}
 */
export function checkWorkspace(root, options = {}) {
  const workspace = readWorkspace(root);
  const version = fixedVersion(workspace);
  const distTag = distTagFor(version);
  if (options.expectedVersion !== undefined && options.expectedVersion !== version) {
    fail(`the tree is at ${version}, not the expected ${options.expectedVersion}`);
  }
  for (const pkg of workspace.packages) {
    if (!packageHasCode(root, pkg) && !pkg.private) {
      fail(`${pkg.name} has no src/ and must be "private": true until it has code`);
    }
  }
  const pre = readPre(root);
  if (version.includes("-") && pre === null) {
    fail(`${version} is a prerelease but ${CHANGESET_DIR}/${PRE_FILE} is missing`);
  }
  if (options.publish === true && !version.includes("-") && pre !== null) {
    fail(
      `${version} is stable but ${CHANGESET_DIR}/${PRE_FILE} still targets ${pre.base}; run release:pre-exit before a stable publish`,
    );
  }
  return { version, distTag, pre };
}

/**
 * Write a new changeset with a generated (never user-supplied) file name.
 * @param {string} root
 * @param {{ name: string, bump: string, summary: string }} input
 * @returns {string} the written file
 */
export function writeChangeset(root, { name, bump, summary }) {
  if (typeof name !== "string") fail(`package name must be a string, got ${typeof name}`);
  if (!isBump(bump)) fail(`bump must be one of ${BUMPS.join(", ")}, got "${bump}"`);
  const workspace = readWorkspace(root);
  const pkg = workspace.packages.find((candidate) => candidate.name === name);
  if (!pkg) fail(`unknown package "${name}"`);
  if (pkg.private) fail(`"${name}" is private and is never published; name a public package`);
  const text = assertSummary(summary);

  // The package name is validated against the workspace and the remaining characters are sanitized, so the
  // generated name cannot traverse directories or contain a separator.
  const slug = `${name
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()}-${bump}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const dir = path.join(root, CHANGESET_DIR);
  const file = path.join(dir, `${slug}.md`);
  if (path.dirname(file) !== dir) fail("refusing to write a changeset outside .changeset");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `---\n"${name}": ${bump}\n---\n\n${text}\n`);
  return file;
}
