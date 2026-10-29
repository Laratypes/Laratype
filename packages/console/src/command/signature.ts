/**
 * Command signatures (docs/v1/services.md › Console commands): one string holds the command name, its arguments
 * and its options, and the types are read from the same string.
 *
 * `"send:mail {user} {--queue=}"`, `"deploy {env=production} {tags*}"`, `"clean {--dry-run} {--level=info}"` and a
 * `" : "` description after the parameters (`"send:mail {user} : Send the welcome mail"`). The grammar is the one
 * Laravel's `Artisan::command(signature, closure)` uses.
 */

/** One argument of a signature. `kind` decides whether commander makes it required, optional or variadic. */
export interface SignatureArgument {
  readonly name: string;
  readonly kind: "required" | "optional" | "default" | "rest";
  /** The default value of `{name=default}`. */
  readonly default?: string;
}

/** One option of a signature. `flag` takes no value; `value` and `rest` do (`--opt=`, `--opt=default`, `--opt=*`). */
export interface SignatureOption {
  /** The flag without its leading dashes (`dry-run`). */
  readonly name: string;
  /** The key commander stores the value under (`dryRun`). */
  readonly key: string;
  readonly kind: "flag" | "value" | "rest";
  /** The default value of `--opt=default`. */
  readonly default?: string;
}

export interface ParsedSignature {
  readonly name: string;
  readonly description?: string;
  readonly arguments: readonly SignatureArgument[];
  readonly options: readonly SignatureOption[];
}

/** A malformed signature. Thrown at registration time, before commander parses anything. */
export class CommandSignatureError extends Error {
  override name = "CommandSignatureError";

  readonly signature: string;

  constructor(signature: string, reason: string) {
    super(`Invalid command signature ${JSON.stringify(signature)}: ${reason}`);
    this.signature = signature;
  }
}

const DESCRIPTION_SEPARATOR = " : ";
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const PARAMETER_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
/** Commander's camelcase splits on `-`, so empty segments would crash it: one dash between name segments. */
const OPTION_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*$/;

/** `--dry-run` -> `dryRun`, the key commander uses (its own `camelcase` in commander/lib/option.js). */
export function optionKey(name: string): string {
  return name.replace(/-+([A-Za-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/**
 * Parses a signature. The command name is the first word; every `{...}` is an argument (`{name}`, `{name?}`,
 * `{name=default}`, `{name*}`) or an option (`{--flag}`, `{--opt=}`, `{--opt=default}`, `{--opt=*}`). The
 * description, when present, starts at the first `" : "`.
 */
export function parseSignature(signature: string): ParsedSignature {
  const text = signature.trim();
  if (!text) throw new CommandSignatureError(signature, "the signature is empty");

  const separator = text.indexOf(DESCRIPTION_SEPARATOR);
  const head = (separator === -1 ? text : text.slice(0, separator)).trim();
  const description =
    separator === -1 ? undefined : text.slice(separator + DESCRIPTION_SEPARATOR.length).trim() || undefined;
  const [name, ...tokens] = head.split(/\s+/);
  if (!name || !NAME_PATTERN.test(name)) {
    throw new CommandSignatureError(signature, `"${name ?? ""}" is not a valid command name`);
  }

  const args: SignatureArgument[] = [];
  const options: SignatureOption[] = [];
  const keys = new Set<string>();

  const addKey = (key: string) => {
    if (keys.has(key)) throw new CommandSignatureError(signature, `"${key}" is declared twice`);
    keys.add(key);
  };

  for (const token of tokens) {
    if (!token.startsWith("{") || !token.endsWith("}")) {
      throw new CommandSignatureError(signature, `"${token}" is neither an argument nor an option: wrap it in { }`);
    }
    const body = token.slice(1, -1);
    if (body.startsWith("--")) {
      const option = parseOption(signature, body.slice(2));
      addKey(option.key);
      options.push(option);
      continue;
    }
    if (body.startsWith("-")) {
      throw new CommandSignatureError(signature, `"${token}" uses a short option: use a long --option instead`);
    }
    const arg = parseArgument(signature, body);
    addKey(arg.name);
    args.push(arg);
  }

  return { name, description, arguments: args, options };
}

function parseArgument(signature: string, body: string): SignatureArgument {
  const [namePart, ...defaultParts] = body.split("=");
  const hasDefault = defaultParts.length > 0;
  const rest = !hasDefault && namePart.endsWith("*");
  const optional = !hasDefault && !rest && namePart.endsWith("?");
  const name = namePart.replace(/[*?]$/, "");
  if (!PARAMETER_PATTERN.test(name)) {
    throw new CommandSignatureError(signature, `"${body}" is not a valid argument name`);
  }
  return hasDefault
    ? { name, kind: "default", default: defaultParts.join("=") }
    : { name, kind: rest ? "rest" : optional ? "optional" : "required" };
}

function parseOption(signature: string, body: string): SignatureOption {
  const equals = body.indexOf("=");
  const name = equals === -1 ? body : body.slice(0, equals);
  if (!OPTION_NAME_PATTERN.test(name)) {
    throw new CommandSignatureError(signature, `"--${body}" is not a valid option name`);
  }
  const value = equals === -1 ? undefined : body.slice(equals + 1);
  const key = optionKey(name);
  if (equals === -1) return { name, key, kind: "flag" };
  if (value === "*") return { name, key, kind: "rest" };
  if (value === "") return { name, key, kind: "value" };
  return { name, key, kind: "value", default: value };
}

type Trim<S extends string> = S extends ` ${infer Rest}`
  ? Trim<Rest>
  : S extends `${infer Head} `
    ? Trim<Head>
    : S;

type Words<S extends string> = Trim<S> extends ""
  ? []
  : Trim<S> extends `${infer Head} ${infer Rest}`
    ? [Head, ...Words<Rest>]
    : [Trim<S>];

/** The part before the first `" : "`: the description never contributes arguments or options. */
type WithoutDescription<S extends string> = S extends `${infer Head} : ${string}` ? Head : S;

type ArgumentSpec<Token extends string> = Token extends `{--${string}}`
  ? never
  : Token extends `{${infer Body}}`
    ? Body extends `${infer Name}=${string}`
      ? { name: Name; kind: "default" }
      : Body extends `${infer Name}*`
        ? { name: Name; kind: "rest" }
        : Body extends `${infer Name}?`
          ? { name: Name; kind: "optional" }
          : { name: Body; kind: "required" }
    : never;

type OptionSpec<Token extends string> = Token extends `{--${infer Body}}`
  ? Body extends `${infer Name}=`
    ? { name: Name; kind: "value" }
    : Body extends `${infer Name}=*`
      ? { name: Name; kind: "rest" }
      : Body extends `${infer Name}=${infer Default}`
        ? { name: Name; kind: "value"; default: Default }
        : { name: Body; kind: "flag" }
  : never;

type Tokens<S extends string> = Words<WithoutDescription<S>>[number];

type ArgumentSpecs<S extends string> = ArgumentSpec<Tokens<S>>;
type OptionSpecs<S extends string> = OptionSpec<Tokens<S>>;

type SpecName<Spec> = Spec extends { name: infer Name extends string } ? Name : never;

/** The argument names of a signature; `string` when the signature is not a literal (a 0.5 command). */
export type ArgumentName<S extends string = string> = string extends S ? string : SpecName<ArgumentSpecs<S>>;

/** The option flag names of a signature, without the dashes (`dry-run`); `string` when the signature is not literal. */
export type OptionName<S extends string = string> = string extends S ? string : SpecName<OptionSpecs<S>>;

type FindArgument<S extends string, Name extends string> = Extract<ArgumentSpecs<S>, { name: Name }>;
type FindOption<S extends string, Name extends string> = Extract<OptionSpecs<S>, { name: Name }>;

/** The value `this.argument(name)` returns: `string`, `string | undefined` or `string[]`. */
export type ArgumentValue<S extends string = string, Name extends ArgumentName<S> = ArgumentName<S>> = string extends S
  ? string
  : [FindArgument<S, Name>] extends [never]
    ? string
    : FindArgument<S, Name> extends { kind: "rest" }
      ? string[]
      : FindArgument<S, Name> extends { kind: "required" | "default" }
        ? string
        : string | undefined;

/** The value `this.option(name)` returns: boolean for flags, strings for values, an array for `--opt=*`. */
export type OptionValue<S extends string = string, Name extends OptionName<S> = OptionName<S>> = string extends S
  ? string | boolean | undefined
  : [FindOption<S, Name>] extends [never]
    ? string | boolean | undefined
    : FindOption<S, Name> extends { kind: "rest" }
      ? string[] | undefined
      : FindOption<S, Name> extends { kind: "flag" }
        ? boolean | undefined
        : FindOption<S, Name> extends { default: string }
          ? string
          : string | undefined;

type CamelCase<S extends string> = S extends `${infer Head}-${infer Rest}`
  ? `${Head}${Capitalize<CamelCase<Rest>>}`
  : S;

/** Flattens an intersection so editors show one object in hover text. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * The input object of a closure command, and what `__setInput()` gives a typed `Command`: one key per argument and
 * one camelCase key per option (`--dry-run` -> `dryRun`). A non-literal signature (`string`) falls back to a loose
 * record, so 0.5 commands keep compiling.
 */
export type CommandInput<S extends string = string> = string extends S
  ? Record<string, unknown>
  : Prettify<
      { [Name in ArgumentName<S>]: ArgumentValue<S, Name> } & {
        [Name in OptionName<S> as CamelCase<Name>]: OptionValue<S, Name>;
      }
    >;
