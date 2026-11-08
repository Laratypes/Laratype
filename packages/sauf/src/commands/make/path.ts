/** The destination folder of each make generator, named in its diagnostic (docs/v1/cli.md › make:* generators). */
export const GENERATOR_FOLDERS = {
  contract: "app/api",
  controller: "app/http/controllers",
  request: "app/http/requests",
  resource: "app/http/resources",
  gate: "src/gates",
  middleware: "src/http/middleware",
  model: "src/models",
  policy: "src/policies",
} as const;

/** A make generator: its key selects the destination folder and the diagnostic's name. */
type Generator = keyof typeof GENERATOR_FOLDERS;

/**
 * A plain folder or file name. A `[param]` segment is a folder, never the file name
 * (docs/v1/contract.md › Contract folder tree).
 */
const PLAIN_SEGMENT = /^[A-Za-z0-9_-]+$/;
const PARAM_FOLDER = /^\[[A-Za-z_][A-Za-z0-9_]*\]$/;
/** A class or function name: the last segment of a generator that writes one (docs/v1/cli.md › make:* generators). */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The rules of `generatorPath` (docs/v1/cli.md › make:* generators). */
interface GeneratorPathOptions {
  /** Allow a `[param]` folder segment (`make:contract`). */
  readonly params?: boolean;
  /** Turn `\` into `/` instead of rejecting it: the 0.5 argument style of `make:contract`. */
  readonly backslashes?: boolean;
  /** The last segment names the exported class or function, so it must be a TypeScript identifier. */
  readonly identifier?: boolean;
}

/**
 * The path under a generator's folder for a command argument, or an error when a segment would leave it
 * (docs/v1/cli.md › make:* generators). A sub-path is kept as folders (`admin/Post` -> `admin/Post`); a trailing
 * `.ts` is accepted and dropped. Callers validate every name before they write the first file.
 */
export function generatorPath(name: string, generator: Generator, options: GeneratorPathOptions = {}): string {
  const normalized = options.backslashes === true ? name.replace(/\\/g, "/") : name;
  const path = normalized.replace(/\.ts$/i, "");
  const segments = path.split("/");
  const valid = segments.every((segment, index) =>
    PLAIN_SEGMENT.test(segment) ||
    (options.params === true && index < segments.length - 1 && PARAM_FOLDER.test(segment)),
  );
  if (!valid) throw new Error(invalidNameMessage(name, generator, options.params === true));
  const file = segments.pop() ?? "";
  if (options.identifier === true && !IDENTIFIER.test(file)) {
    throw new Error(invalidIdentifierMessage(name, generator));
  }
  return path;
}

/** The diagnostic of a name outside the rules (docs/v1/cli.md › Diagnostics). */
function invalidNameMessage(name: string, generator: Generator, params: boolean): string {
  const allowed = params
    ? 'use letters, digits, "_" and "-", or a [param] folder,'
    : 'use letters, digits, "_" and "-", in folders';
  return `Invalid ${generator} name ${JSON.stringify(name)}: ${allowed} under ${GENERATOR_FOLDERS[generator]}.`;
}

/** The diagnostic of a file name that would not be a TypeScript identifier (docs/v1/cli.md › Diagnostics). */
function invalidIdentifierMessage(name: string, generator: Generator): string {
  return [
    `Invalid ${generator} name ${JSON.stringify(name)}: the last segment names the exported class or function,`,
    "so use a valid identifier",
    '(letters, digits and "_", not starting with a digit),',
    `under ${GENERATOR_FOLDERS[generator]}.`,
  ].join(" ");
}
