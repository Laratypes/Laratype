import type { Api, ApiRoute, Method } from "@laratype/contract";
import { OpenApiGenerationError } from "./errors";
import {
  hasBaseDependentRefs,
  hasLocalRefs,
  isJsonObject,
  isParentRef,
  isSchemaResource,
  oneLine,
  pointerSegment,
  rebaseRefs,
  standardJsonSchema,
} from "./schema";
import type { JsonSchema, JsonSchemaIo } from "./schema";

/**
 * The contract side of the generator, loaded from the project's own `@laratype/contract` (`load.ts`): `apiRoutes()`
 * resolves the full paths, the inherited capabilities and the derived errors exactly as the router does, and
 * `isApiRoot()` recognizes the `defineApi` root by its brand. `sauf` takes no dependency on the contract package: the
 * types are type-only and the project supplies the runtime.
 */
export interface OpenApiContract {
  readonly apiRoutes: (api: Api) => ReadonlyArray<ApiRoute>;
  readonly isApiRoot: (value: unknown) => value is Api;
}

/** What `generateOpenApiDocument` needs: the project's contract runtime and the document's `info` metadata. */
export interface OpenApiOptions {
  /** The project's contract runtime (see `OpenApiContract`). */
  readonly contract: OpenApiContract;
  /** `info.title`; default `Laratype API`. */
  readonly title?: string;
  /** `info.version`; default `0.0.0`. */
  readonly version?: string;
}

/** A successful build: the document, plus the warnings for what it could not represent (it is still valid). */
export interface GeneratedOpenApi {
  readonly document: OpenApiDocument;
  /** One line per endpoint/schema or path the document cannot represent; the command prints them. */
  readonly warnings: readonly string[];
}

/** An OpenAPI 3.1 document, with the maps in a deterministic order (see Invariants). */
export interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: { readonly title: string; readonly version: string };
  readonly servers: ReadonlyArray<{ readonly url: string }>;
  readonly paths: Record<string, OpenApiPathItem>;
  readonly components: OpenApiComponents;
}

/** The reusable schemas and the security schemes the operations reference. */
export interface OpenApiComponents {
  readonly schemas: Record<string, JsonSchema>;
  readonly securitySchemes: Record<string, OpenApiSecurityScheme>;
}

/** The scheme of one resolved guard: a bearer token until A2 (#120) says what a guard reads. */
export interface OpenApiSecurityScheme {
  readonly type: "http";
  readonly scheme: "bearer";
  readonly description: string;
}

/** One path item: its operations, in a fixed method order (`get, post, put, patch, delete`). */
export interface OpenApiPathItem {
  readonly [method: string]: OpenApiOperation;
}

/** One endpoint operation: route name, summary, request parameters/body, responses and security. */
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

/** A path, query or header parameter; a path parameter is always required (OpenAPI has no optional ones). */
export interface OpenApiParameter {
  readonly name: string;
  readonly in: "path" | "query" | "header";
  readonly required: boolean;
  readonly description?: string;
  /** A JSON Schema: an object, or the draft 2020-12 boolean form a query/header property can carry (`false` refuses). */
  readonly schema: JsonSchema | boolean;
}

/** A required JSON request body. */
export interface OpenApiRequestBody {
  readonly required: true;
  readonly content: { readonly "application/json": { readonly schema: JsonSchema } };
}

/** One response: a reason phrase, and a JSON schema only when it has a body. */
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

/** The header names OpenAPI reserves for its own use: a parameter with one of them is ignored by consumers. */
const RESERVED_HEADERS: ReadonlySet<string> = new Set(["accept", "authorization", "content-type"]);

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** An `ErrorDef` is a function carrying `status` and `code`; a custom contract runtime can return anything, which
 * must become one diagnostic rather than a TypeError in `responses()`. */
const isErrorEntry = (value: unknown): boolean => {
  if (typeof value !== "function" && !isJsonObject(value)) return false;
  const { status, code } = value as { status?: unknown; code?: unknown };
  return (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599 &&
    typeof code === "string" &&
    code !== ""
  );
};

/** A success status, the rule the contract's endpoint builder enforces: an integer from 200 to 299. A custom contract
 * runtime can return any `def`, so the route guard checks it before `responses()` keys the success response by it. */
const isSuccessStatus = (value: unknown): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= 200 && value <= 299;

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
  `/${segments
    .map((segment) => (segment.kind === "param" ? `{${segment.name}}` : encodeLiteral(segment.text)))
    .join("/")}`;

/** Two templates OpenAPI cannot tell apart: `/x/{a}` and `/x/{b}` group on `/x/{}`. */
const pathGroupKey = (template: string): string => template.replace(/\{[^}]*\}/g, "{}");

/** What a path matches, without its parameter names: two paths with the same shape answer the same requests. */
const pathShape = (segments: readonly PathSegment[]): string =>
  segments
    .map((segment) =>
      segment.kind === "param"
        ? `:${segment.pattern ?? ""}${segment.optional ? "?" : ""}`
        : `=${encodeLiteral(segment.text)}`,
    )
    .join("/");

// ---- the document ---------------------------------------------------------------------------------------------------

/**
 * The OpenAPI 3.1 document of a contract tree, built from `appApi` (the `defineApi` root) and the project's contract
 * runtime. Pure: no Node import. `apiRoutes()` throws on an inconsistent tree (a contract bug), which propagates.
 *
 * The output is deterministic: paths, components and schemes are sorted, methods and statuses have a fixed order, and
 * every map is built with `Object.fromEntries`, so a route name or property named `__proto__` is an own key.
 */
export function generateOpenApiDocument(api: unknown, options: OpenApiOptions): GeneratedOpenApi {
  const contract = options?.contract;
  if (typeof contract?.apiRoutes !== "function" || typeof contract.isApiRoot !== "function") {
    throw new OpenApiGenerationError("options.contract must provide apiRoutes() and isApiRoot()");
  }
  if (typeof api !== "object" || api === null || !contract.isApiRoot(api)) {
    throw new OpenApiGenerationError("the appApi must be the root that defineApi returns");
  }
  const routes = contract.apiRoutes(api);
  if (!Array.isArray(routes)) throw new OpenApiGenerationError("apiRoutes() must return an array of routes");
  const methodNames = new Set<string>(METHOD_ORDER);
  for (const route of routes) {
    // The contract runtime is the project's package, but it is still an input: a wrong one gets one diagnostic, not
    // a TypeError (or a silently dropped operation) from the walk below.
    if (
      typeof route?.name !== "string" ||
      typeof route.path !== "string" ||
      !methodNames.has(route.method) ||
      typeof route.endpoint?.def !== "object" ||
      route.endpoint.def === null ||
      !isSuccessStatus((route.endpoint.def as { status?: unknown }).status) ||
      !Array.isArray(route.errors) ||
      !route.errors.every(isErrorEntry) ||
      (route.auth !== undefined && route.auth !== true && typeof route.auth !== "string")
    ) {
      throw new OpenApiGenerationError(
        "apiRoutes() returned an invalid route: it needs a name, a method, a path, an endpoint with a 2xx status, errors and auth",
      );
    }
  }
  // One group per OpenAPI path template. `/x/{a}` and `/x/{b}` are the same path for OpenAPI: the first template's
  // parameter names win, and a later operation keeps its own schemas under them (found by position).
  const groups = new Map<
    string,
    { segments: PathSegment[]; template: string; entries: Array<{ route: ApiRoute; own: PathSegment[] }> }
  >();
  for (const route of routes) {
    const own = parsePath(route.path);
    const template = pathTemplate(own);
    const key = pathGroupKey(template);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { segments: own, template, entries: [{ route, own }] });
    else group.entries.push({ route, own });
  }

  // A same-method route the group drops is not served, so its guard must not declare a scheme or shift a kept guard's
  // key. Keep exactly the routes the path loop below keeps (the first per method and template).
  const keptRoutes: ApiRoute[] = [];
  for (const group of groups.values()) {
    const methods = new Set<Method>();
    for (const { route } of group.entries) {
      if (methods.has(route.method)) continue;
      methods.add(route.method);
      keptRoutes.push(route);
    }
  }

  // One scheme per kept guard identity, chosen up front in sorted name order: two names that sanitize alike
  // (`staff/login`, `staff_login`) get `_2` whatever order the tree defines them in, and the operations below can use
  // the final key directly (no provisional security keys, no second pass over the paths).
  const guardNames = [
    ...new Set(
      keptRoutes.flatMap((route): string[] =>
        route.auth === undefined ? [] : [route.auth === true ? "default" : route.auth],
      ),
    ),
  ].sort(compare);
  const usedGuards = new Set<string>();
  const guardKeys = new Map<string, string>();
  for (const name of guardNames) {
    const clean = `guard_${name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    let key = clean;
    for (let n = 2; usedGuards.has(key); n += 1) key = `${clean}_${n}`;
    usedGuards.add(key);
    guardKeys.set(name, key);
  }
  const securitySchemes = guardNames.map((name): [string, OpenApiSecurityScheme] => [
    guardKeys.get(name)!,
    {
      type: "http",
      scheme: "bearer",
      // The contract names a guard, not what it reads: A2 (#120) decides the real scheme per guard.
      description: `The ${name} guard.`,
    },
  ]);

  const warnings: string[] = [];
  const components = new Map<string, { readonly base: string; readonly schema: JsonSchema }>();
  let nextComponent = 0;

  /** Registers a component and returns its provisional key; the final key is chosen below, in sorted base order. */
  const hoist = (base: string, build: (key: string) => JsonSchema): string => {
    // A provisional key, marked with NUL (which no final key or sane ref has): the final one is chosen below, in
    // sorted base order, so it does not depend on the tree's definition order (two route names can sanitize alike).
    const provisional = `\u0000${nextComponent}`;
    nextComponent += 1;
    components.set(provisional, { base, schema: build(provisional) });
    return provisional;
  };

  const component = (base: string, build: (key: string) => JsonSchema): JsonSchema => ({
    $ref: `#/components/schemas/${hoist(base, build)}`,
  });

  const convert = (route: string, label: string, schema: unknown, io: JsonSchemaIo): JsonSchema => {
    const result = standardJsonSchema(schema, io);
    if (!result.ok) {
      warnings.push(
        oneLine(
          `${JSON.stringify(route)}: the ${label} schema has no JSON Schema (${result.reason}); it is documented as {}`,
        ),
      );
      return {};
    }
    // A root $id makes the schema its own resource: its refs already resolve, so it stays inline.
    return hasLocalRefs(result.schema)
      ? component(`${route}.${label}`, (key) => rebaseRefs(result.schema, key))
      : result.schema;
  };

  /**
   * The query or headers parameters of one endpoint: the schema's `properties`, in declaration order, `required` from
   * its `required` list. A property with a local `$ref`, or with a relative reference that only resolves against the
   * schema root's `$id`, is served by hoisting the whole query/headers schema (once per endpoint and slot) and
   * referencing the property inside it: the refs keep the root schema as their base, `$id` included, so `#`,
   * `#/$defs/...`, `#anchor`, a relative `$ref` (`filter.json`) and a relative `$dynamicRef` still point at what they
   * meant in the source schema. A property with no such reference is inlined.
   */
  const propertyParameters = (route: ApiRoute, label: "query" | "headers"): OpenApiParameter[] => {
    const def = route.endpoint.def;
    const schema = label === "query" ? def.query : def.headers;
    if (schema === undefined) return [];
    const result = standardJsonSchema(schema, "input");
    if (!result.ok) {
      const notDocumented = `the ${label} parameters are not documented`;
      warnings.push(
        oneLine(
          `${JSON.stringify(route.name)}: the ${label} schema has no JSON Schema (${result.reason}); ${notDocumented}`,
        ),
      );
      return [];
    }
    const root = result.schema;
    if (!isJsonObject(root.properties)) return [];
    const required = new Set(
      Array.isArray(root.required) ? root.required.filter((name): name is string => typeof name === "string") : [],
    );
    const location = label === "query" ? ("query" as const) : ("header" as const);
    const parameters: OpenApiParameter[] = [];
    let rootKey: string | undefined;
    for (const [name, property] of Object.entries(root.properties)) {
      let json: JsonSchema | boolean;
      if (typeof property === "boolean") {
        // draft 2020-12 boolean schemas are valid everywhere a schema is (OAS 3.1's Schema Object is object|boolean):
        // true accepts every value, false refuses every value, so neither may become {}
        json = property;
      } else if (!isJsonObject(property)) {
        warnings.push(
          oneLine(
            `${JSON.stringify(route.name)}: the ${label} property ${JSON.stringify(name)} is not a JSON Schema; it is documented as {}`,
          ),
        );
        json = {};
      } else if (isParentRef(property)) {
        // The property is the whole query/headers schema: reference the hoisted root, and warn that as a parameter it
        // overlaps its siblings under form/explode serialization.
        rootKey ??= hoist(`${route.name}.${label}`, (key) => rebaseRefs(root, key));
        json = { $ref: `#/components/schemas/${rootKey}` };
        warnings.push(
          oneLine(
            `${JSON.stringify(route.name)}: the ${label} property ${JSON.stringify(name)} is documented as the whole ${label} schema; its parameter overlaps the sibling parameters`,
          ),
        );
      } else if (hasLocalRefs(property) || (isSchemaResource(root) && hasBaseDependentRefs(property))) {
        // The parent's $id is the property's base: keep the property in the hoisted root, which keeps that $id, instead
        // of extracting it to a document where a relative ref would resolve against the OpenAPI document.
        rootKey ??= hoist(`${route.name}.${label}`, (key) => rebaseRefs(root, key));
        json = { $ref: `#/components/schemas/${rootKey}/properties/${pointerSegment(name)}` };
      } else {
        json = property;
      }
      if (location === "header" && RESERVED_HEADERS.has(name.toLowerCase())) {
        warnings.push(
          oneLine(
            `${JSON.stringify(route.name)}: the header ${JSON.stringify(name)} is reserved by OpenAPI; its definition is ignored`,
          ),
        );
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
    return Object.fromEntries(
      [...all].sort(([a], [b]) => a - b).map(([status, response]) => [String(status), response]),
    );
  };

  const schemeOf = (route: ApiRoute): ReadonlyArray<Record<string, readonly string[]>> => {
    if (route.auth === undefined) return [];
    const guard = route.auth === true ? "default" : route.auth;
    return [{ [guardKeys.get(guard)!]: [] }];
  };

  const operation = (
    route: ApiRoute,
    template: string,
    own: readonly PathSegment[],
    canonical: readonly string[],
  ): OpenApiOperation => {
    const def = route.endpoint.def;
    const names = paramSegments(own).map((segment, index) => canonical[index] ?? segment.name);
    const parameters = [
      ...pathParameters(own, names),
      ...propertyParameters(route, "query"),
      ...propertyParameters(route, "headers"),
    ];
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

  const paths: Array<[string, OpenApiPathItem]> = [];
  for (const group of groups.values()) {
    const canonical = paramSegments(group.segments).map((segment) => segment.name);
    const methods = new Map<Method, OpenApiOperation>();
    const served = new Map<Method, { readonly route: ApiRoute; readonly own: readonly PathSegment[] }>();
    for (const { route, own } of group.entries) {
      const first = served.get(route.method);
      if (first !== undefined) {
        // Which route the router serves for a template is registration order, not tree order, and it differs for the
        // two routes when their shapes do (a regex or an optional segment). Keep the first in tree order as the
        // document's choice, and say what the retained operation then leaves out rather than claiming the router.
        const sameRequests = pathShape(own) === pathShape(first.own);
        const retained = `${JSON.stringify(route.name)} and ${JSON.stringify(first.route.name)} both answer ${route.method.toUpperCase()} ${group.template}; keeping ${JSON.stringify(first.route.name)} (first in tree order)`;
        warnings.push(
          oneLine(
            sameRequests
              ? retained
              : `${retained}; requests that the router answers with ${JSON.stringify(route.name)} (${JSON.stringify(route.path)}) are not described by the retained operation`,
          ),
        );
        continue;
      }
      served.set(route.method, { route, own });
      methods.set(route.method, operation(route, group.template, own, canonical));
    }
    paths.push([
      group.template,
      Object.fromEntries(
        METHOD_ORDER.filter((method) => methods.has(method)).map((method) => [method, methods.get(method)!]),
      ),
    ]);
  }

  // The final component keys are chosen in sorted base order, not creation (tree) order: two route names that sanitize
  // to the same key get the same keys whichever order the tree defines them in.
  const ordered = [...components].sort(([aKey, a], [bKey, b]) => compare(a.base, b.base) || compare(aKey, bKey));
  const used = new Set<string>();
  const finals = new Map<string, string>();
  for (const [provisional, { base }] of ordered) {
    const clean = base.replace(/[^A-Za-z0-9._-]/g, "_") || "_";
    let key = clean;
    for (let n = 2; used.has(key); n += 1) key = `${clean}_${n}`;
    used.add(key);
    finals.set(provisional, key);
  }
  const schemas = ordered
    .map(([provisional, entry]): [string, JsonSchema] => [finals.get(provisional)!, entry.schema])
    .sort(([a], [b]) => compare(a, b));

  const document: OpenApiDocument = {
    openapi: "3.1.0",
    info: { title: metadataText(options?.title, "Laratype API"), version: metadataText(options?.version, "0.0.0") },
    servers: [{ url: "/" }],
    paths: Object.fromEntries(paths.sort(([a], [b]) => compare(a, b))),
    components: {
      schemas: Object.fromEntries(schemas),
      securitySchemes: Object.fromEntries(securitySchemes),
    },
  };
  return { document: rewriteComponentRefs(document, finals), warnings };
}

const SCHEMA_REF = "#/components/schemas/";

/** The reference keywords a generated pointer can sit in: `$ref` and the `$dynamicRef` JSON Pointer form. */
const COMPONENT_REF_KEYWORDS: ReadonlySet<string> = new Set(["$ref", "$dynamicRef"]);

/**
 * Replaces the provisional component keys (a NUL and a number) in every `$ref` and `$dynamicRef` this generator wrote
 * with the final key chosen in sorted base order. Only those refs carry the NUL marker (a final key cannot), so a
 * schema's own ref — a named dynamic reference included — is untouched.
 */
function rewriteComponentRefs(document: OpenApiDocument, finals: ReadonlyMap<string, string>): OpenApiDocument {
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!isJsonObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => {
        if (!COMPONENT_REF_KEYWORDS.has(name) || typeof child !== "string" || !child.startsWith(SCHEMA_REF)) {
          return [name, rewrite(child)];
        }
        const [provisional, ...rest] = child.slice(SCHEMA_REF.length).split("/");
        const key = provisional === undefined ? undefined : finals.get(provisional);
        return [name, key === undefined ? child : `${SCHEMA_REF}${key}${rest.length ? `/${rest.join("/")}` : ""}`];
      }),
    );
  };
  return rewrite(document) as OpenApiDocument;
}
