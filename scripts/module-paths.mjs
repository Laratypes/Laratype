// @ts-check
// Build-machine paths in build output (B25 #329). `scripts/check-dist.mjs` scans package dists and the
// sauf resources bundles for the repository root, and `bun.build.js` rewrites the `file://` URLs Bun
// folds `import.meta.url` into (CJS builds have no `import.meta`, so Bun replaces it with the source
// file's URL) back to a runtime expression. Both accept the root as given and its real path
// (`fs.realpathSync.native`), because Bun writes the resolved path through a junction, symlink or subst
// drive. Both use the forms below.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * A form is the root only as a whole segment: the character after it ends the path or starts a
 * separator or a quote. This keeps `/app` out of `resources/app/x` and `laratype` out of
 * `laratype-fork`.
 * @param {string | undefined} char
 */
const isEnd = (char) => char === undefined || char === '/' || char === '\\' || char === '"' || char === "'" || char === '`'

/**
 * The rule on the left rejects only a path character before the form: a letter, digit, `.`, `_` or `-`
 * means the form is a segment suffix. Any other character (`(`, `=`, `:`, `,`, `[`, `;`, a separator, a
 * quote, whitespace) or the start of the file means the form starts a path.
 * @param {string | undefined} char
 */
const isStart = (char) => char === undefined || !/[A-Za-z0-9._-]/.test(char)

/**
 * The forms one root takes in a file: the `file://` URL (plus its decoded variant), native separators,
 * forward slashes, and the doubled backslashes of a JS/JSON string literal (`"D:\\repo"`).
 * @param {string} root
 * @param {{ pathApi: Pick<typeof path, 'isAbsolute'>, toFileURL: (path: string) => URL }} options
 * @returns {string[]}
 */
const rootForms = (root, { pathApi, toFileURL }) => {
  // Drop a trailing separator so a dist holding the root with and without one is reported alike.
  const base = root.replace(/[\\/]+$/, '')
  const forward = base.replace(/\\/g, '/')
  const backslash = base.replace(/\//g, '\\')
  /** @type {string[]} */
  const forms = []
  if (pathApi.isAbsolute(base)) {
    // Bun writes the resolved path as the URL pathToFileURL produces: a space is %20, a non-ASCII
    // character is UTF-8, and a UNC root is file://server/share/... and not file:////server/... .
    const url = toFileURL(base).href.replace(/\/$/, '')
    forms.push(url)
    const decoded = decodeURIComponent(url)
    if (decoded !== url) forms.push(decoded)
  } else {
    // A synthetic root that is not absolute on this platform (the tests use a Windows-style root on
    // POSIX) has no pathToFileURL form; build the URL by hand.
    forms.push(forward.startsWith('/') ? `file://${forward}` : `file:///${forward}`)
  }
  forms.push(forward, backslash, backslash.replace(/\\/g, '\\\\'))
  return forms
}

/**
 * The forms any of `roots` takes in a file, deduplicated.
 * @param {string | string[]} roots
 * @param {{ pathApi?: Pick<typeof path, 'isAbsolute'>, toFileURL?: (path: string) => URL }} [options]
 *   Injected for a cross-platform test; production uses `path` and `pathToFileURL`.
 * @returns {string[]}
 */
export const buildRootForms = (roots, { pathApi = path, toFileURL = pathToFileURL } = {}) => {
  const list = Array.isArray(roots) ? roots : [roots]
  return [...new Set(list.flatMap(root => rootForms(root, { pathApi, toFileURL })))].filter(form => form.length > 1)
}

/**
 * Where `contents` first contains a form of any of `roots`, and which form. The first offset wins, so a
 * URL is reported at its `file:///` offset and not at the path inside it.
 * @param {string} contents
 * @param {string | string[]} roots
 * @param {{ caseInsensitive?: boolean }} [options] `true` on Windows, where the drive and folders can differ in case.
 * @returns {{ index: number, form: string } | undefined}
 */
export const findBuildRoot = (contents, roots, { caseInsensitive = false } = {}) => {
  const haystack = caseInsensitive ? contents.toLowerCase() : contents
  /** @type {{ index: number, form: string } | undefined} */
  let hit
  for (const form of buildRootForms(roots)) {
    const needle = caseInsensitive ? form.toLowerCase() : form
    // A rejected hit (a segment suffix or a sibling) must not stop the search for a later one.
    for (let from = 0; ;) {
      const index = haystack.indexOf(needle, from)
      if (index === -1) break
      if (isStart(contents[index - 1]) && isEnd(contents[index + form.length])) {
        if (!hit || index < hit.index || (index === hit.index && form.length > hit.form.length)) hit = { index, form }
        break
      }
      from = index + 1
    }
  }
  return hit
}

/** The runtime expression that replaces a folded module URL in a CJS build. */
export const CJS_MODULE_URL = 'require("node:url").pathToFileURL(__filename).href'

/**
 * Every file under `dir` that contains a form of any of `roots`, with the first offset in it.
 * @param {string} dir
 * @param {string | string[]} roots
 * @param {{ caseInsensitive?: boolean }} [options]
 * @returns {{ file: string, index: number, form: string }[]}
 */
export const findBuildRootInTree = (dir, roots, options = {}) => {
  /** @type {{ file: string, index: number, form: string }[]} */
  const hits = []
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else {
        const hit = findBuildRoot(readFileSync(full, 'utf8'), roots, options)
        if (hit) hits.push({ file: full, ...hit })
      }
    }
  }
  walk(dir)
  return hits
}

/**
 * @param {string} value
 * @returns {string}
 */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The same end boundary as `isEnd`, as a lookahead for the rewrite regex. */
const END_LOOKAHEAD = '(?=[/\\\\"\'`]|$)'

/**
 * Rewrites every `file://<root>/...` string literal in a CJS build to `CJS_MODULE_URL`, in every URL
 * form (plain, percent-encoded and decoded) of any of `roots`, so the bundle resolves relative to
 * itself and not to the source file it was built from. ESM builds keep `import.meta.url` and are not
 * passed here.
 * @param {string} code
 * @param {string | string[]} roots
 * @param {{ caseInsensitive?: boolean }} [options]
 * @returns {{ code: string, rewritten: number }}
 */
export const keepRuntimeModuleUrl = (code, roots, { caseInsensitive = false } = {}) => {
  const urls = buildRootForms(roots).filter(form => form.startsWith('file://'))
  if (!urls.length) return { code, rewritten: 0 }
  const pattern = new RegExp(urls.map(escapeRegExp).join('|') + END_LOOKAHEAD, caseInsensitive ? 'gi' : 'g')
  /** @type {string[]} */
  const parts = []
  let from = 0
  let rewritten = 0
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    const quote = code[match.index - 1]
    // Only a string literal can become an expression; anything else is left for check:dist to report.
    if (quote !== '"' && quote !== "'") continue
    const end = code.indexOf(quote, match.index)
    if (end === -1) continue
    parts.push(code.slice(from, match.index - 1), CJS_MODULE_URL)
    from = end + 1
    rewritten += 1
    pattern.lastIndex = from
  }
  return { code: rewritten ? parts.join('') + code.slice(from) : code, rewritten }
}
