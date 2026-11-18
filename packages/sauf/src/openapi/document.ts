import type { ApiRoute, Method } from "@laratype/contract";
import { OpenApiGenerationError } from "./errors";
import {
  hasLocalRefs,
  isJsonObject,
  isParentRef,
  rebaseRefs,
  standardJsonSchema,
  withParentDefs,
} from "./schema";
import type { JsonSchema, JsonSchemaIo } from "./schema";

/**
 * The contract side of the generator, loaded from the project's own `@laratype/contract` (`load.ts`): `apiRoutes()`
 * resolves the full paths, the inherited capabilities and the derived errors exactly as the router does, and
 * `isApiRoot()` recognizes the `defineApi` root by its brand. `sauf` takes no dependency on the contract package.
 */
export interface OpenApiContract {
  readonly apiRoutes: (api: object) => ReadonlyArray<ApiRoute>;
  readonly isApiRoot: (value: unknown) => value is object;
}

export interface OpenApiOptions {
  /** The project's contract runtime (see `OpenApiContract`). */
  readonly contract: OpenApiContract;
  /** `info.title`; default `Laratype API`. */
  readonly title?: string;
  /** `info.version`; default `0.0.0`. */
  readonly version?: string;
}

export interface GeneratedOpenApi {
  readonly document: OpenApiDocument;
  /** One line per endpoint/schema or path the document cannot represent; the command prints them. */
  readonly warnings: readonly string[];
}

export interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: { readonly title: string; readonly version: string };
  readonly servers: ReadonlyArray<{ readonly url: string }>;
  readonly paths: Record<string, OpenApiPathItem>;
  readonly components: OpenApiComponents;
}

export interface OpenApiComponents {
  readonly schemas: Record<string, JsonSchema>;
  readonly securitySchemes: Record<string, OpenApiSecurityScheme>;
}

export interface OpenApiSecurityScheme {
  readonly type: "http";
  readonly scheme: "bearer";
  readonly description: string;
}

/** One path item: its operations, in a fixed method order (`get, post, put, patch, delete`). */
export interface OpenApiPathItem {
  readonly [method: string]: OpenApiOperation;
}

export interface OpenApiOperation {
  readonly operationId: string;
  readonly summary: string;
  readonly parameters?: ReadonlyArray<OpenApiParameter>;
  readonly requestBody?: OpenApiRequestBody;
  /** Keyed by status; ascending. */
  readonly responses: Record<string, OpenApiResponse>;
  /** `[]` for a public operation: OpenAPI requires it on every operation or at the root. */
  readonly security: ReadonlyArray<Record<string, readonly string[]>>;
}

export interface OpenApiParameter {
  readonly name: string;
  readonly in: "path" | "query" | "header";
  readonly required: boolean;
  readonly description?: string;
  readonly schema: JsonSchema;
}

export interface OpenApiRequestBody {
  readonly required: true;
  readonly content: { readonly "application/json": { readonly schema: JsonSchema } };
}

export interface OpenApiResponse {
  readonly description: string;
  readonly content?: { readonly "application/json": { readonly schema: JsonSchema } };
}

const OPTIONAL_PATH_PARAM = "optional path parameter: the router also matches the path without this segment";

/** The HTTP reason phrases a contract status can take; anything else is `Success`. */
const REASON: Readonly<Record<number, string>> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
};

const METHOD_ORDER: readonly Method[] = ["get", "post", "put", "patch", "delete"];

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A non-empty string, or the fallback: `info` requires both fields. */
const metadataText = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() !== "" ? value : fallback;

// ---- path parsing ---------------------------------------------------------------------------------------------------

type PathSegment =
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "param"; readonly name: string; readonly pattern: string | undefined; readonly optional: boolean };

/** `:id{re}?` names are written inside `{...}`, so a brace in a name becomes `_` to keep the template valid. */
const paramName = (name: string): string => name.replace(/[{}]/g, "_");

/**
 * The contract path, split the way Hono reads it: a `/` inside a regex pattern (`:file{.+/.+}`) stays in its
 * segment, a `:name` is a param (with `{regex}` and/or `?`), everything else is a literal. The path starts with `/`.
 */
function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let text = "";
  // A param is pushed as its own segment: the "/" that follows it must not push an empty literal too.
  let afterParam = false;
  const push = (): void => {
    segments.push({ kind: "literal", text });
    text = "";
    afterParam = false;
  };
  const endsWithSlash = path.length > 1 && path.endsWith("/");
  let i = path.startsWith("/") ? 1 : 0;
  while (i < path.length) {
    const char = path[i]!;
    if (char === "/") {
      if (text !== "" || !afterParam) push();
      afterParam = false;
      i += 1;
      continue;
    }
    if (char === ":" && text === "") {
      let j = i + 1;
      let name = "";
      while (j < path.length && path[j] !== "/" && path[j] !== "?" && path[j] !== "{") {
        name += path[j];
        j += 1;
      }
      let optional = false;
      if (path[j] === "?") {
        optional = true;
        j += 1;
      }
      let pattern: string | undefined;
      if (path[j] === "{") {
        const start = j + 1;
        let depth = 0;
        j = start;
        while (j < path.length) {
          if (path[j] === "{") depth += 1;
          else if (path[j] === "}") {
            if (depth === 0) break;
            depth -= 1;
          }
          j += 1;
        }
        pattern = path.slice(start, j);
        if (path[j] === "}") j += 1;
      }
      if (path[j] === "?") {
        optional = true;
        j += 1;
      }
      if (name === "") {
        // A bare ":" is not a param (Hono needs a name): keep the text as written.
        text += path.slice(i, j);
        i = j;
        continue;
      }
      segments.push({ kind: "param", name: paramName(name), pattern, optional });
      afterParam = true;
      i = j;
      continue;
    }
    text += char;
    afterParam = false;
    i += 1;
  }
  if (text !== "" || endsWithSlash || segments.length === 0) push();
  return segments;
}

type ParamSegment = Extract<PathSegment, { kind: "param" }>;

const paramSegments = (segments: readonly PathSegment[]): ParamSegment[] =>
  segments.filter((segment): segment is ParamSegment => segment.kind === "param");

/** `{` `}` `?` `#` in a literal are URL delimiters: percent-encode them so they are not read as templating. */
const ENCODE: Readonly<Record<string, string>> = { "{": "%7B", "}": "%7D", "?": "%3F", "#": "%23" };

const encodeLiteral = (value: string): string => value.replace(/[{}?#]/g, (c) => ENCODE[c]!);

/** The OpenAPI path template: params as `{name}`, literals encoded. */
const pathTemplate = (segments: readonly PathSegment[]): string =>
  `/${segments.map((segment) => (segment.kind === "param" ? `{${segment.name}}` : encodeLiteral(segment.text))).join("/")}`;

/** Two templates OpenAPI cannot tell apart: `/x/{a}` and `/x/{b}` group on `/x/{}`. */
const pathGroupKey = (template: string): string => template.replace(/\{[^}]*\}/g, "{}");

// ---- the document ---------------------------------------------------------------------------------------------------

/**
 * The OpenAPI 3.1 document of a contract tree, built from `appApi` (the `defineApi` root) and the project's contract
 * runtime. Pure: no Node import. `apiRoutes()` throws on an inconsistent tree (a contract bug), which propagates.
 *
 * The output is deterministic: paths, components and schemes are sorted, methods and statuses have a fixed order, and
 * every map is built with `Object.fromEntries`, so a route name or property named `__proto__` is an own key.
 */
export function generateOpenApiDocument(api: object, options: OpenApiOptions): GeneratedOpenApi {
  const { contract } = options ?? ({} as OpenApiOptions);
  if (typeof contract?.apiRoutes !== "function" || typeof contract?.isApiRoot !== "function") {
    throw new OpenApiGenerationError("options.contract must provide apiRoutes() and isApiRoot()");
  }
  if (typeof api !== "object" || api === null || !contract.isApiRoot(api)) {
    throw new OpenApiGenerationError("the appApi must be the root that defineApi returns");
  }
  const routes = contract.apiRoutes(api);
  const warnings: string[] = [];
  const schemas = new Map<string, JsonSchema>();
  const keys = new Set<string>();
  const guards = new Map<string, Set<string>>();

  const component = (base: string, build: (key: string) => JsonSchema): JsonSchema => {
    const clean = base.replace(/[^A-Za-z0-9._-]/g, "_") || "_";
    let key = clean;
    for (let n = 2; keys.has(key); n += 1) key = `${clean}_${n}`;
    keys.add(key);
    schemas.set(key, build(key));
    return { $ref: `#/components/schemas/${key}` };
  };

  const convert = (route: string, label: string, schema: unknown, io: JsonSchemaIo): JsonSchema => {
    const result = standardJsonSchema(schema, io);
    if (!result.ok) {
      warnings.push(`${route}: the ${label} schema has no JSON Schema (${result.reason}); it is documented as {}`);
      return {};
    }
    // A root $id makes the schema its own resource: its refs already resolve, so it stays inline.
    return hasLocalRefs(result.schema) ? component(`${route}.${label}`, (key) => rebaseRefs(result.schema, key)) : result.schema;
  };

  /**
   * The query or headers parameters of one endpoint: the schema's `properties`, in declaration order, `required` from
   * its `required` list. A property with a local `$ref` is hoisted on its own, since a parameter schema's refs resolve
   * against the document, not against the parent schema.
   */
  const propertyParameters = (route: ApiRoute, label: "query" | "headers", location: "query" | "header"): OpenApiParameter[] => {
    const def = route.endpoint.def;
    const schema = label === "query" ? def.query : def.headers;
    if (schema === undefined) return [];
    const result = standardJsonSchema(schema, "input");
    if (!result.ok) {
      warnings.push(`${route.name}: the ${label} schema has no JSON Schema (${result.reason}); the ${label} parameters are not documented`);
      return [];
    }
    const root = result.schema;
    if (!isJsonObject(root.properties)) return [];
    const required = new Set(
      Array.isArray(root.required) ? root.required.filter((name): name is string => typeof name === "string") : [],
    );
    const parameters: OpenApiParameter[] = [];
    for (const [name, property] of Object.entries(root.properties)) {
      let json: JsonSchema;
      if (!isJsonObject(property)) {
        warnings.push(`${route.name}: the ${label} property "${name}" is not a JSON Schema object; it is documented as {}`);
        json = {};
      } else if (isParentRef(property)) {
        warnings.push(`${route.name}: the ${label} property "${name}" only refers to the ${label} schema itself; it is documented as {}`);
        json = {};
      } else if (hasLocalRefs(property)) {
        json = component(`${route.name}.${label}.${name}`, (key) => rebaseRefs(withParentDefs(root, property), key));
      } else {
        json = property;
      }
      parameters.push({ name, in: location, required: required.has(name), schema: json });
    }
    return parameters;
  };

  const pathParameters = (segments: readonly PathSegment[], names: readonly string[]): OpenApiParameter[] => {
    const seen = new Set<string>();
    const parameters: OpenApiParameter[] = [];
    paramSegments(segments).forEach((segment, index) => {
      const name = names[index] ?? segment.name;
      if (seen.has(name)) return;
      seen.add(name);
      parameters.push({
        name,
        in: "path",
        required: true,
        ...(segment.optional ? { description: OPTIONAL_PATH_PARAM } : {}),
        schema: { type: "string", ...(segment.pattern ? { pattern: `^(?:${segment.pattern})$` } : {}) },
      });
    });
    return parameters;
  };

  const responses = (route: ApiRoute): Record<string, OpenApiResponse> => {
    const def = route.endpoint.def;
    const all = new Map<number, OpenApiResponse>();
    all.set(def.status, {
      description: REASON[def.status] ?? "Success",
      ...(def.response === undefined
        ? {}
        : {
            content: {
              "application/json": { schema: convert(route.name, "response", def.response, "output") },
            },
          }),
    });
    const codes = new Map<number, string[]>();
    for (const error of route.errors) {
      const list = codes.get(error.status) ?? [];
      if (!list.includes(error.code)) list.push(error.code);
      codes.set(error.status, list);
    }
    for (const [status, list] of codes) {
      if (all.has(status)) continue;
      all.set(status, {
        description: list.join(", "),
        content: {
          "application/json": {
            // An ErrorDef carries its status and code at run time only: the body is type-only and goes on the wire as
            // `{ code, ...body }` (docs/v1/contract.md › Domain errors), so the extra keys stay open.
            schema: {
              type: "object",
              required: ["code"],
              properties: { code: { type: "string", enum: list } },
              additionalProperties: true,
            },
          },
        },
      });
    }
    return Object.fromEntries([...all].sort(([a], [b]) => a - b).map(([status, response]) => [String(status), response]));
  };

  const schemeOf = (route: ApiRoute): ReadonlyArray<Record<string, readonly string[]>> => {
    if (route.auth === undefined) return [];
    const guard = route.auth === true ? "default" : route.auth;
    const key = `guard_${guard.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const labels = guards.get(key) ?? new Set<string>();
    labels.add(guard);
    guards.set(key, labels);
    return [{ [key]: [] }];
  };

  const operation = (route: ApiRoute, template: string, own: readonly PathSegment[], canonical: readonly string[]): OpenApiOperation => {
    const def = route.endpoint.def;
    const names = paramSegments(own).map((segment, index) => canonical[index] ?? segment.name);
    const parameters = [...pathParameters(own, names), ...propertyParameters(route, "query", "query"), ...propertyParameters(route, "headers", "header")];
    return {
      operationId: route.name,
      summary: `${route.method.toUpperCase()} ${template}`,
      ...(parameters.length ? { parameters } : {}),
      ...(def.body === undefined
        ? {}
        : {
            requestBody: {
              required: true as const,
              content: { "application/json": { schema: convert(route.name, "body", def.body, "input") } },
            },
          }),
      responses: responses(route),
      security: schemeOf(route),
    };
  };

  // One group per OpenAPI path template. `/x/{a}` and `/x/{b}` are the same path for OpenAPI: the first template's
  // parameter names win, and a later operation keeps its own schemas under them (found by position).
  const groups = new Map<string, { segments: PathSegment[]; template: string; entries: Array<{ route: ApiRoute; own: PathSegment[] }> }>();
  for (const route of routes) {
    const own = parsePath(route.path);
    const template = pathTemplate(own);
    const key = pathGroupKey(template);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { segments: own, template, entries: [{ route, own }] });
    else group.entries.push({ route, own });
  }

  const paths: Array<[string, OpenApiPathItem]> = [];
  for (const group of groups.values()) {
    const canonical = paramSegments(group.segments).map((segment) => segment.name);
    const methods = new Map<Method, OpenApiOperation>();
    const served = new Map<Method, string>();
    for (const { route, own } of group.entries) {
      const first = served.get(route.method);
      if (first !== undefined) {
        // Hono answers with the first of two routes with the same method and path: keep it, as the router does.
        warnings.push(`${route.name} and ${first} both answer ${route.method.toUpperCase()} ${group.template}; keeping ${first}`);
        continue;
      }
      served.set(route.method, route.name);
      methods.set(route.method, operation(route, group.template, own, canonical));
    }
    paths.push([
      group.template,
      Object.fromEntries(METHOD_ORDER.filter((method) => methods.has(method)).map((method) => [method, methods.get(method)!])),
    ]);
  }

  const securitySchemes = [...guards]
    .sort(([a], [b]) => compare(a, b))
    .map(([key, labels]): [string, OpenApiSecurityScheme] => {
      const names = [...labels].sort(compare);
      return [
        key,
        {
          type: "http",
          scheme: "bearer",
          // The contract names a guard, not what it reads: A2 (#120) decides the real scheme per guard.
          description: names.length === 1 ? `The ${names[0]} guard.` : `The ${names.join(", ")} guards.`,
        },
      ];
    });

  return {
    document: {
      openapi: "3.1.0",
      info: { title: metadataText(options?.title, "Laratype API"), version: metadataText(options?.version, "0.0.0") },
      servers: [{ url: "/" }],
      paths: Object.fromEntries(paths.sort(([a], [b]) => compare(a, b))),
      components: {
        schemas: Object.fromEntries([...schemas].sort(([a], [b]) => compare(a, b))),
        securitySchemes: Object.fromEntries(securitySchemes),
      },
    },
    warnings,
  };
}
