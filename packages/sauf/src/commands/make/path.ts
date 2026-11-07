/** The destination folder of each v1 generator, named in its diagnostic (docs/v1/cli.md › make:* generators). */
export const GENERATOR_FOLDERS = {
  contract: "app/api",
  controller: "app/http/controllers",
  request: "app/http/requests",
  resource: "app/http/resources",
} as const;

/** A v1 generator: its key selects the destination folder and the diagnostic's name. */
type Generator = keyof typeof GENERATOR_FOLDERS;

/** A plain folder or file name. A `[param]` segment is a folder, never the file name (docs/v1/contract.md › Contract folder tree). */
const PLAIN_SEGMENT = /^[A-Za-z0-9_-]+$/;
const PARAM_FOLDER = /^\[[A-Za-z_][A-Za-z0-9_]*\]$/;

/** The rules of `generatorPath` (docs/v1/cli.md › make:* generators). */
interface GeneratorPathOptions {
  /** Allow a `[param]` folder segment (`make:contract`). */
  readonly params?: boolean;
  /** Turn `\` into `/` instead of rejecting it: the 0.5 argument style of `make:contract`. */
  readonly backslashes?: boolean;
}

/**
 * The path under a generator's folder for a command argument, or an error when a segment would leave it
 * (docs/v1/cli.md › make:* generators). A sub-path is kept as folders (`admin/Post` -> `admin/Post`); a trailing
 * `.ts` is accepted and dropped. Callers validate every name before they write the first file.
 */
export function generatorPath(name: string, generator: Generator, options: GeneratorPathOptions = {}): string {
  const normalized = options.backslashes === true ? name.replace(/\\/g, "/") : name;
  const path = normalized.replace(/\.ts$/, "");
  const segments = path.split("/");
  const valid = segments.every((segment, index) =>
    PLAIN_SEGMENT.test(segment) ||
    (options.params === true && index < segments.length - 1 && PARAM_FOLDER.test(segment)),
  );
  if (valid) return path;
  throw new Error(invalidName(name, generator, options.params === true));
}

/** The diagnostic of a name outside the rules (docs/v1/cli.md › Diagnostics). */
function invalidName(name: string, generator: Generator, params: boolean): string {
  const allowed = params
    ? 'use letters, digits, "_" and "-", or a [param] folder,'
    : 'use letters, digits, "_" and "-", in folders';
  return `Invalid ${generator} name ${JSON.stringify(name)}: ${allowed} under ${GENERATOR_FOLDERS[generator]}.`;
}
