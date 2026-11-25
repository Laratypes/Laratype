/**
 * The 422 envelope of the Laratype contract pipeline, built from the same Zod issues the other three apps get:
 * `{ code: "VALIDATION_ERROR", message, errors }`, where `errors` is a dot-path -> messages bag.
 *
 * This is a copy of the framework's own mapping (packages/http/src/request/input.ts, `publicIssue` /
 * `unprocessable`, and packages/contract/src/validate.ts, `toErrorBag`), so the four apps send byte-identical bodies.
 * It stays derived from the parsed issues: nothing here is per-scenario data.
 */

const RECEIVED = 'received '

/** A message ending in a letter, digit or combining mark (whole code points): `received` after it is not a word. */
const ENDS_IN_WORD = /[\p{L}\p{N}\p{M}]$/u

const SEPARATOR = /[\s,:]/

const issuePath = (issue) =>
  (issue.path ?? []).map((segment) => (typeof segment === 'object' ? segment.key : segment))

const dotPath = (issue) => issuePath(issue).map(String).join('.')

/** `text` without the separators left before a cut tail: `, `, `: `, ` but `, in any mix. */
const trimSeparators = (text) => {
  let end = text.length
  for (;;) {
    while (end > 0 && SEPARATOR.test(text[end - 1])) end--
    if (end < 4 || !/\s/.test(text[end - 4]) || text.slice(end - 3, end).toLowerCase() !== 'but') return text.slice(0, end)
    end -= 3
  }
}

/** The index of `received <value>` at the end of a message, as a word, bare or quoted, in any case. */
const receivedAt = (message, received) => {
  for (const value of [received, `'${received}'`, `"${received}"`]) {
    const at = message.length - value.length - RECEIVED.length
    if (at < 0 || ENDS_IN_WORD.test(message.slice(0, at))) continue
    if (message.slice(at).toLowerCase() === `${RECEIVED}${value}`.toLowerCase()) return at
  }
  return -1
}

/** An issue's message without the submitted data; `cut` tells whether a cut shortened it. */
const issueMessage = (issue) => {
  const { message, code, received, keys } = issue
  if (Array.isArray(keys) && keys.length > 0) {
    const at = message.indexOf(': ')
    if (at !== -1 && keys.every((key) => message.slice(at).includes(String(key)))) return { message: message.slice(0, at), cut: true }
  }
  if (code === 'invalid_type' || !['string', 'number', 'boolean', 'bigint'].includes(typeof received)) return { message, cut: false }
  const at = receivedAt(message, String(received))
  return at === -1 ? { message, cut: false } : { message: trimSeparators(message.slice(0, at)), cut: true }
}

/** What a 422 may carry of an issue: `{ path, message }` only, never the library's `input` or `received`. */
const publicIssue = (issue) => {
  const { message, cut } = issueMessage(issue)
  return {
    path: issuePath(issue),
    message: cut && message.trim() === '' ? 'Invalid value' : message,
  }
}

/** dot path -> messages; a null prototype, as the framework's `ErrorBag`. */
const toErrorBag = (issues) => {
  const bag = Object.create(null)
  for (const issue of issues) (bag[dotPath(issue)] ??= []).push(issue.message)
  return bag
}

/** The exact body `unprocessable()` of @laratype/http answers with. */
export const validationError = (issues) => ({
  code: 'VALIDATION_ERROR',
  message: 'The given data was invalid.',
  errors: toErrorBag(issues.map(publicIssue)),
})
