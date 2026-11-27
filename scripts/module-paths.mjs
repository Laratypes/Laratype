// @ts-check
// Build-machine paths in build output (B25 #329). `scripts/check-dist.mjs` scans package dists for the
// repository root, and `bun.build.js` rewrites the `file://` URLs Bun folds `import.meta.url` into
// (CJS builds have no `import.meta`, so Bun replaces it with the source file's URL) back to a runtime
// expression. Both use the forms below.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The forms the build root takes in a file: native separators, forward slashes for the URL Bun writes,
 * the `file://` URL, its percent-encoded form (`pathToFileURL` encodes a space or a non-ASCII character,
 * which Bun writes as `%20` / `%C3%A9`), and the doubled backslashes of a JS/JSON string literal
 * (`"D:\\repo"`).
 * @param {string} root
 * @returns {string[]}
 */
export const buildRootForms = (root) => {
  // Drop a trailing separator so a dist holding the root with and without one is reported alike.
  const base = root.replace(/[\\/]+$/, '')
  const forward = base.replace(/\\/g, '/')
  const backslash = base.replace(/\//g, '\\')
  const url = forward.startsWith('/') ? `file://${forward}` : `file:///${forward}`
  const forms = [
    url,
    forward,
    backslash,
    backslash.replace(/\\/g, '\\\\'),
  ]
  // Bun writes the URL `pathToFileURL` produces, which percent-encodes a space or a non-ASCII
  // character. Only keep it when it is the encoded variant of `url`: pathToFileURL resolves a path for
  // the current platform, so a synthetic root for another platform would get the cwd instead.
  const encoded = pathToFileURL(base).href
  if (decodeURIComponent(encoded) === url) forms.push(encoded)
  return [...new Set(forms)].filter(form => form.length > 1)
}

/**
 * Where `contents` first contains a form of `root`, and which form. The first offset wins, so a URL is
 * reported at its `file:///` offset and not at the path inside it.
 * @param {string} contents
 * @param {string} root
 * @param {{ caseInsensitive?: boolean }} [options] `true` on Windows, where the drive and folders can differ in case.
 * @returns {{ index: number, form: string } | undefined}
 */
export const findBuildRoot = (contents, root, { caseInsensitive = false } = {}) => {
  const haystack = caseInsensitive ? contents.toLowerCase() : contents
  /** @type {{ index: number, form: string } | undefined} */
  let hit
  for (const form of buildRootForms(root)) {
    const index = haystack.indexOf(caseInsensitive ? form.toLowerCase() : form)
    if (index === -1) continue
    if (!hit || index < hit.index || (index === hit.index && form.length > hit.form.length)) hit = { index, form }
  }
  return hit
}

/** The runtime expression that replaces a folded module URL in a CJS build. */
export const CJS_MODULE_URL = 'require("node:url").pathToFileURL(__filename).href'

/**
 * Every file under `dir` that contains a form of `root`, with the first offset in it.
 * @param {string} dir
 * @param {string} root
 * @param {{ caseInsensitive?: boolean }} [options]
 * @returns {{ file: string, index: number, form: string }[]}
 */
export const findBuildRootInTree = (dir, root, options = {}) => {
  /** @type {{ file: string, index: number, form: string }[]} */
  const hits = []
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else {
        const hit = findBuildRoot(readFileSync(full, 'utf8'), root, options)
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

/**
 * Rewrites every `file://<root>/...` string literal in a CJS build to `CJS_MODULE_URL`, in both the
 * plain and the percent-encoded URL form, so the bundle resolves relative to itself and not to the
 * source file it was built from. ESM builds keep `import.meta.url` and are not passed here.
 * @param {string} code
 * @param {string} root
 * @param {{ caseInsensitive?: boolean }} [options]
 * @returns {{ code: string, rewritten: number }}
 */
export const keepRuntimeModuleUrl = (code, root, { caseInsensitive = false } = {}) => {
  const urls = buildRootForms(root).filter(form => form.startsWith('file://'))
  if (!urls.length) return { code, rewritten: 0 }
  const pattern = new RegExp(urls.map(escapeRegExp).join('|'), caseInsensitive ? 'gi' : 'g')
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
