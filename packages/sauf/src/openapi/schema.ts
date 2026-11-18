/**
 * The schema side of the OpenAPI generator: a Standard Schema's optional JSON Schema extension
 * (`~standard.jsonSchema`, the Standard JSON Schema v1 proposal) and the `$ref` handling OpenAPI needs.
 *
 * The extension is duck-typed here, so `sauf` stays schema-agnostic (the contract package never imports a schema
 * library). zod 4 implements it; a schema without it (valibot 1.x today) falls back to `{}` with a warning, in
 * `document.ts`. Pure: no Node import, no schema library import.
 */

/** A JSON Schema, as the extension returns it: a JSON object with unknown keywords. */
export type JsonSchema = Record<string, unknown>;

export type JsonSchemaIo = "input" | "output";

export type JsonSchemaResult =
  | { readonly ok: true; readonly schema: JsonSchema }
  | { readonly ok: false; readonly reason: string };

/** The one JSON Schema dialect OpenAPI 3.1 uses. */
const TARGET = "draft-2020-12";

interface StandardJsonSchemaLike {
  readonly "~standard": {
    readonly jsonSchema?: {
      readonly input?: (options: { readonly target: string }) => unknown;
      readonly output?: (options: { readonly target: string }) => unknown;
    } | undefined;
  };
}

export const isJsonObject = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A value's JSON kind, for the fallback warning: `null`, `an array`, `string`, ... */
const jsonKind = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "an array" : value === undefined ? "undefined" : typeof value;

/** A thrown value's message; a non-Error (a string, an object with a throwing accessor) is printed as safely as possible. */
export function errorReason(error: unknown): string {
  try {
    if (typeof error === "object" && error !== null) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim() !== "") return message;
    }
    return String(error);
  } catch {
    return "an error that cannot be printed";
  }
}

/**
 * `schema` as JSON Schema through the Standard JSON Schema extension: `input` for a request slot (what the FE sends,
 * what the server validates), `output` for a response (what the server serializes). A schema without the extension,
 * or one whose conversion throws or does not return a JSON object, is rejected with the reason the caller reports.
 *
 * The result is JSON round-tripped: it drops what JSON cannot hold, rejects a cyclic or BigInt-bearing conversion
 * (`JSON.stringify` throws) and clones the object, so later `$ref` rewriting never touches the schema library's own
 * value. The root `$schema` is dropped: the OpenAPI 3.1 document already declares its dialect.
 */
export function standardJsonSchema(schema: unknown, io: JsonSchemaIo): JsonSchemaResult {
  try {
    const jsonSchema = (schema as StandardJsonSchemaLike | null | undefined)?.["~standard"]?.jsonSchema;
    const convert = jsonSchema?.[io];
    if (typeof convert !== "function") {
      return { ok: false, reason: "it has no Standard JSON Schema extension (~standard.jsonSchema; zod 4 has one)" };
    }
    const raw = convert.call(jsonSchema, { target: TARGET });
    const text = JSON.stringify(raw);
    if (text === undefined) return { ok: false, reason: `it is not JSON (${jsonKind(raw)})` };
    const json: unknown = JSON.parse(text);
    if (!isJsonObject(json)) return { ok: false, reason: `it is not a JSON Schema object (${jsonKind(json)})` };
    delete json.$schema;
    return { ok: true, schema: json };
  } catch (error) {
    return { ok: false, reason: errorReason(error) };
  }
}

/** A schema with a root `$id` is its own JSON Schema resource: its `#` refs resolve against it, not the document. */
export const isSchemaResource = (schema: JsonSchema): boolean => typeof schema.$id === "string";

/**
 * Whether a schema has a `$ref` that starts with `#`, so it only stays valid in place once it is a component: `#` is
 * the whole document, not the schema. A subtree with its own `$id` is a separate resource, so its refs are left alone
 * (and the root `$id` case means the whole schema is inlined unchanged).
 */
export function hasLocalRefs(schema: JsonSchema): boolean {
  let found = false;
  const walk = (value: unknown, resource: boolean): void => {
    if (found) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, resource);
      return;
    }
    if (!isJsonObject(value)) return;
    const nested = resource || isSchemaResource(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && !resource && typeof child === "string" && child.startsWith("#")) {
        found = true;
        return;
      }
      if (key !== "$ref") walk(child, nested);
    }
  };
  walk(schema, isSchemaResource(schema));
  return found;
}

/**
 * A deep JSON clone of `schema` with every `$ref` starting with `#` rebased on `#/components/schemas/<key>`, the
 * component the schema is hoisted to. `#` itself becomes the component, `#/$defs/x` becomes `<component>/$defs/x`.
 * A subtree with its own `$id` keeps its refs: they resolve against that resource.
 */
export function rebaseRefs(schema: JsonSchema, key: string): JsonSchema {
  const prefix = `#/components/schemas/${key}`;
  const clone = (value: unknown, resource: boolean): unknown => {
    if (Array.isArray(value)) return value.map((item) => clone(item, resource));
    if (!isJsonObject(value)) return value;
    const nested = resource || isSchemaResource(value);
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => [
        name,
        name === "$ref" && !resource && typeof child === "string" && child.startsWith("#")
          ? `${prefix}${child.slice(1)}`
          : clone(child, nested),
      ]),
    );
  };
  return clone(schema, isSchemaResource(schema)) as JsonSchema;
}

/**
 * A query/header property hoisted on its own needs the parent schema's `$defs`: the property's `#/$defs/x` refs point
 * at the parent's definitions. A property that brings its own `$defs` keeps them (its names win).
 */
export function withParentDefs(root: JsonSchema, property: JsonSchema): JsonSchema {
  const defs = root.$defs;
  if (!isJsonObject(defs) || isJsonObject(property.$defs)) return property;
  return { ...property, $defs: defs };
}

/** Whether a property schema is only a ref back to its parent schema (`{ "$ref": "#" }`): nothing to complete it. */
export const isParentRef = (schema: JsonSchema): boolean =>
  Object.keys(schema).length === 1 && schema.$ref === "#";
