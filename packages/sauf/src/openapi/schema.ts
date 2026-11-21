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

/** Which half of a schema is wanted: `input` for a request slot, `output` for a response. */
export type JsonSchemaIo = "input" | "output";

/** The conversion result: the JSON Schema, or the one-line reason the schema is documented as `{}` instead. */
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

/** A thrown value's message; a non-Error (a string, an object with a throwing accessor) is printed as safely as
 * possible. */
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

/** Terminal controls (C0, DEL, C1) and Unicode format controls (bidi overrides, isolates, ...) that would reach the
 * terminal raw: printed as `\uXXXX`. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu;

/** One line, no stack: a jiti import failure and the circular-structure message both print their stack in the
 * message of some errors. Warnings and the load diagnostics go through this, so a terminal line stays one line and
 * a control or format character or ANSI escape anywhere in it (a converter's message included) never reaches the
 * terminal. */
export const oneLine = (error: unknown): string =>
  errorReason(error)
    .replace(/\s+/g, " ")
    .trim()
    .replace(CONTROL, (character) => {
      // With the `u` flag a matched astral character is two UTF-16 units: escape both, not just the high surrogate.
      let escaped = "";
      for (let index = 0; index < character.length; index += 1) {
        escaped += `\\u${character.charCodeAt(index).toString(16).padStart(4, "0")}`;
      }
      return escaped;
    }) || "an unknown error";

/**
 * `schema` as JSON Schema through the Standard JSON Schema extension: `input` for a request slot (what the FE sends,
 * what the server validates), `output` for a response (what the server serializes). A schema without the extension,
 * or one whose conversion throws, does not return a JSON object, or puts a non-finite number in a numeric keyword, is
 * rejected with the reason the caller reports.
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
    if (isJsonObject(raw)) {
      const bound = nonFiniteBound(raw);
      if (bound !== undefined) return { ok: false, reason: `it has a ${bound} that is not a finite number` };
    }
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
 * The keywords whose value is a schema (or a map/array of schemas), for the JSON Pointer path of an anchor. Every
 * other keyword is still walked: draft-07 `dependencies`/`additionalItems` and the other schema keywords can hold
 * refs too. `const`, `example`, `enum`, `default` and `examples` hold instance values (where a `$ref`-shaped key is
 * data, not a reference), and so do OpenAPI `x-*` vendor extensions (zod `.meta()` copies `example`/`x-*` into the
 * output), so they are never walked.
 */
const SCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  "$defs",
  "definitions",
  "dependencies",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);
const INSTANCE_KEYWORDS: ReadonlySet<string> = new Set(["const", "default", "enum", "example", "examples"]);

/** OpenAPI vendor extension keys (`x-*`) are metadata, not schemas: never traversed or rewritten. */
const isVendorKey = (key: string): boolean => key.startsWith("x-");

/** One JSON Pointer segment: the RFC 6901 `~0`/`~1` escaping, then percent-encoded for a URI fragment (RFC 6901 § 6),
 * so a space, `%`, `#` or a non-ASCII name in a `$ref` stays one segment. Characters a fragment allows stay as
 * written (`$defs` included); only the rest is percent-encoded. */
const FRAGMENT_UNSAFE = /[^A-Za-z0-9\-._~!$&'()*+,;=:@]/gu;
export const pointerSegment = (name: string): string =>
  name
    .replace(/~/g, "~0")
    .replace(/\//g, "~1")
    .replace(FRAGMENT_UNSAFE, (character) => {
      try {
        return encodeURIComponent(character);
      } catch {
        // a lone surrogate has no UTF-8 form; encode the replacement character a URI can carry
        return "%EF%BF%BD";
      }
    });

/**
 * Walks every schema-valued position in `root`, in document order, with the JSON Pointer of each and whether it sits
 * inside a schema resource (`$id`), itself included. Every keyword is walked except the instance keywords; a map
 * keyword contributes its key as a pointer segment. A cyclic schema is visited once and left to `JSON.stringify` to
 * reject.
 */
function walkSchemas(root: JsonSchema, visit: (schema: JsonSchema, resource: boolean, pointer: string) => void): void {
  const stack = new WeakSet<object>();
  const walk = (value: unknown, resource: boolean, pointer: string): void => {
    if (Array.isArray(value)) {
      if (stack.has(value)) return;
      stack.add(value);
      value.forEach((item, index) => walk(item, resource, `${pointer}/${index}`));
      stack.delete(value);
      return;
    }
    if (!isJsonObject(value) || stack.has(value)) return;
    const nested = resource || isSchemaResource(value);
    stack.add(value);
    visit(value, nested, pointer);
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" || key === "$dynamicRef" || INSTANCE_KEYWORDS.has(key) || isVendorKey(key)) continue;
      if (SCHEMA_MAP_KEYWORDS.has(key) && isJsonObject(child)) {
        for (const [name, sub] of Object.entries(child)) {
          walk(sub, nested, `${pointer}/${pointerSegment(key)}/${pointerSegment(name)}`);
        }
      } else {
        walk(child, nested, `${pointer}/${pointerSegment(key)}`);
      }
    }
    stack.delete(value);
  };
  walk(root, false, "");
}

/** The numeric and integer keywords whose values are finite JSON numbers. A draft-04 boolean is allowed only for the
 * two exclusive bounds; every other non-number is still refused. */
const EXCLUSIVE_BOUNDS: ReadonlySet<string> = new Set(["exclusiveMaximum", "exclusiveMinimum"]);
const NUMERIC_KEYWORDS: ReadonlySet<string> = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
]);

/** The first numeric keyword in `root` whose value is not a finite number (the only non-numbers allowed are the
 * draft-04 booleans of the two exclusive bounds), with its JSON kind; `undefined` if none. `JSON.stringify` would turn
 * `NaN`/`Infinity` into `null`, which the round trip would otherwise accept. */
function nonFiniteBound(root: JsonSchema): string | undefined {
  let found: string | undefined;
  walkSchemas(root, (schema) => {
    if (found !== undefined) return;
    // in the schema's own key order, so the reason names the keyword the user's schema lists first
    for (const [key, bound] of Object.entries(schema)) {
      if (!NUMERIC_KEYWORDS.has(key)) continue;
      if (typeof bound === "boolean" && EXCLUSIVE_BOUNDS.has(key)) continue;
      if (typeof bound !== "number" || !Number.isFinite(bound)) {
        found = `${key} (${jsonKind(bound)})`;
        return;
      }
    }
  });
  return found;
}

/**
 * Whether a schema has a `$ref` or `$dynamicRef` that starts with `#`, so it only stays valid in place once it is a
 * component: `#` is the whole document, not the schema. A subtree with its own `$id` is a separate resource, so its
 * refs are left alone (and the root `$id` case means the whole schema is inlined unchanged). Only schema positions
 * are visited: a `$ref`-shaped key under `const`, `enum`, `default` or `examples` is an instance value, not a
 * reference.
 */
export function hasLocalRefs(schema: JsonSchema): boolean {
  let found = false;
  walkSchemas(schema, (value, resource) => {
    if (found || resource) return;
    if (typeof value.$ref === "string" && value.$ref.startsWith("#")) found = true;
    else if (typeof value.$dynamicRef === "string" && value.$dynamicRef.startsWith("#")) found = true;
  });
  return found;
}

/** The `$anchor` names in the root schema's own resource (a nested `$id` starts another resource, whose anchors are
 * not reachable from a root-scope `#name`), with the JSON Pointer of each. The first of a duplicate name wins. */
function anchorsOf(root: JsonSchema): ReadonlyMap<string, string> {
  const anchors = new Map<string, string>();
  walkSchemas(root, (schema, resource, pointer) => {
    if (resource) return;
    const anchor = schema.$anchor;
    if (typeof anchor === "string" && !anchors.has(anchor)) anchors.set(anchor, pointer);
  });
  return anchors;
}

/** Rewrites one local `$ref` of a schema hoisted to `prefix`: `#` and `#/...` are JSON Pointer fragments, while
 * `#name` is a named anchor and resolves to the pointer of its `$anchor`. An unknown anchor is left as written. */
function rebaseLocalRef(ref: string, prefix: string, anchors: ReadonlyMap<string, string>): string {
  if (ref === "#") return prefix;
  if (ref.startsWith("#/")) return `${prefix}${ref.slice(1)}`;
  let name = ref.slice(1);
  try {
    name = decodeURIComponent(name);
  } catch {
    // an invalid percent escape stays as written, like an unknown anchor
  }
  const pointer = anchors.get(name);
  return pointer === undefined ? ref : `${prefix}${pointer}`;
}

/** `$dynamicRef` is only rebased when it is a JSON Pointer fragment (`#`, `#/...`): an anchor form (`#name`) keeps
 * its dynamic scope and cannot be renamed per component; that dynamic-anchor limitation is documented. */
function rebaseDynamicRef(ref: string, prefix: string): string {
  if (ref === "#") return prefix;
  return ref.startsWith("#/") ? `${prefix}${ref.slice(1)}` : ref;
}

/**
 * A deep JSON clone of `schema` with every `$ref` starting with `#` rebased on `#/components/schemas/<key>`, the
 * component the schema is hoisted to. `#` itself becomes the component, `#/$defs/x` becomes `<component>/$defs/x` and
 * `#anchor` becomes the component pointer of its `$anchor` in the root resource. `$dynamicRef` is rebased only for
 * its JSON Pointer forms (`#`, `#/...`); its anchor form keeps its dynamic scope. A subtree with its own `$id` keeps
 * its refs, the subtree's own `$ref` included: they resolve against that resource. Instance values under `const`,
 * `example`, `enum`, `default` and `examples`, and `x-*` vendor metadata, are copied as they are, even when they hold
 * a `$ref`-shaped key. Every other keyword is cloned, so a ref under `dependencies`, `additionalItems` or another
 * schema keyword is rebased too.
 */
export function rebaseRefs(schema: JsonSchema, key: string): JsonSchema {
  const prefix = `#/components/schemas/${key}`;
  const anchors = anchorsOf(schema);
  const clone = (value: unknown, resource: boolean): unknown => {
    if (Array.isArray(value)) return value.map((item) => clone(item, resource));
    if (!isJsonObject(value)) return value;
    const nested = resource || isSchemaResource(value);
    const out: JsonSchema = {};
    for (const [name, child] of Object.entries(value)) {
      if (name === "$ref" && typeof child === "string") {
        out[name] = !nested && child.startsWith("#") ? rebaseLocalRef(child, prefix, anchors) : child;
      } else if (name === "$dynamicRef" && typeof child === "string") {
        out[name] = !nested && child.startsWith("#") ? rebaseDynamicRef(child, prefix) : child;
      } else if (INSTANCE_KEYWORDS.has(name) || isVendorKey(name)) {
        out[name] = child;
      } else if (SCHEMA_MAP_KEYWORDS.has(name) && isJsonObject(child)) {
        out[name] = Object.fromEntries(Object.entries(child).map(([def, sub]) => [def, clone(sub, nested)]));
      } else {
        out[name] = clone(child, nested);
      }
    }
    return out;
  };
  return clone(schema, false) as JsonSchema;
}

/** Whether a property schema is only a ref back to its parent schema (`{ "$ref": "#" }`): nothing to complete it. */
export const isParentRef = (schema: JsonSchema): boolean =>
  Object.keys(schema).length === 1 && schema.$ref === "#";
