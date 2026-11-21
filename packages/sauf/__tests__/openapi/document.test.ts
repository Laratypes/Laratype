import * as z from "zod";
import { defineApi, defineContract, defineError, defineScope, endpoint } from "@laratype/contract";
import type { StandardSchemaV1 } from "@laratype/contract";
import { describe, expect, it } from "vitest";
import { OpenApiGenerationError, generateOpenApiDocument } from "../../src/openapi";
import type { JsonSchema, OpenApiContract, OpenApiOperation, OpenApiParameter } from "../../src/openapi";
import { openApi, refs } from "./support";

const User = z.object({ id: z.number(), name: z.string() });
const NewUser = z.object({ name: z.string(), email: z.string() });
const EmailTaken = defineError(409, "EMAIL_TAKEN", (email: string) => ({ email }));
const UsernameTaken = defineError(409, "USERNAME_TAKEN", (username: string) => ({ username }));

const users = defineContract()(
  {
    index: endpoint
      .get("/")
      .query(z.object({ page: z.coerce.number<number>().optional(), tag: z.array(z.string()).optional() }))
      .headers(z.object({ "x-trace": z.string().optional() }))
      .response(z.array(User)),
    show: endpoint.get("/:id{[0-9]+}").response(User),
    store: endpoint.post("/").body(NewUser).response(User, 201).throws(EmailTaken, UsernameTaken),
    destroy: endpoint.delete("/:id").status(202),
  },
  { auth: true },
);

const Post = z.object({ id: z.number(), title: z.string() });
const AccountLocked = defineError(403, "ACCOUNT_LOCKED");
const UserScope = defineScope()({
  auth: true,
  authorize: true,
  throttle: { limit: 10, per: "1m" },
  throws: [AccountLocked],
});
const posts = defineContract()({
  index: endpoint.get("/").response(z.array(Post)).authorize(false),
  update: endpoint.patch("/:post").body(Post.pick({ title: true })).response(Post),
});
const health = defineContract()({
  check: endpoint.get("/").public().throttle(false).response(z.object({ ok: z.boolean() })),
});

const appApi = defineApi({
  users: { contract: users, path: "/api/users", scopes: [] },
  "users.posts": {
    contract: posts,
    path: "/api/users/:user/posts",
    scopes: [{ scope: UserScope, dir: "users/[user]" }],
  },
  "v1.health": { contract: health, path: "/api/v1/health", scopes: [] },
});

const built = openApi(appApi);
const doc = built.document;

const operation = (path: string, method: string): OpenApiOperation => {
  const item = doc.paths[path];
  expect(item, path).toBeDefined();
  const found = item![method];
  expect(found, `${method} ${path}`).toBeDefined();
  return found!;
};

const parameter = (operationValue: OpenApiOperation, name: string, where: string): OpenApiParameter => {
  const found = operationValue.parameters?.find((item) => item.name === name && item.in === where);
  expect(found, `${where} ${name}`).toBeDefined();
  return found!;
};

const content = (response: { readonly content?: { readonly "application/json": { readonly schema: JsonSchema } } }) =>
  response.content?.["application/json"].schema;

describe("generateOpenApiDocument", () => {
  it("writes an OpenAPI 3.1 document with the project metadata and a same-origin server", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual({ title: "test-api", version: "9.9.9" });
    expect(doc.servers).toEqual([{ url: "/" }]);
    expect(openApi(appApi).warnings).toEqual([]);
  });

  it("lists one path per template, sorted, with methods in a fixed order", () => {
    expect(Object.keys(doc.paths)).toEqual([
      "/api/users",
      "/api/users/{id}",
      "/api/users/{user}/posts",
      "/api/users/{user}/posts/{post}",
      "/api/v1/health",
    ]);
    // show (GET with a pattern) and destroy (DELETE) are one path item: OpenAPI identifies a path by its template
    expect(Object.keys(doc.paths["/api/users/{id}"]!)).toEqual(["get", "delete"]);
  });

  it("maps route names to operationId/summary and auth to a security requirement", () => {
    const index = operation("/api/users", "get");
    expect(index.operationId).toBe("users.index");
    expect(index.summary).toBe("GET /api/users");
    expect(index.security).toEqual([{ guard_default: [] }]);
    expect(doc.components.securitySchemes.guard_default).toEqual({
      type: "http",
      scheme: "bearer",
      description: "The default guard.",
    });

    // a public endpoint carries an explicit empty requirement, which redocly's security-defined rule requires
    expect(operation("/api/v1/health", "get").security).toEqual([]);
  });

  it("gives two guards whose sanitized names collide distinct schemes, in any definition order", () => {
    const slashGuard = defineContract()({ show: endpoint.get("/a") }, { auth: "staff/login" });
    const underscoreGuard = defineContract()({ show: endpoint.get("/b") }, { auth: "staff_login" });
    const one = defineApi({
      slash: { contract: slashGuard, path: "/api/slash", scopes: [] },
      underscore: { contract: underscoreGuard, path: "/api/underscore", scopes: [] },
    });
    const two = defineApi({
      underscore: { contract: underscoreGuard, path: "/api/underscore", scopes: [] },
      slash: { contract: slashGuard, path: "/api/slash", scopes: [] },
    });
    const first = openApi(one).document;
    // sorted guard names: "staff/login" gets the plain key, "staff_login" the next one
    expect(first.components.securitySchemes).toEqual({
      guard_staff_login: { type: "http", scheme: "bearer", description: "The staff/login guard." },
      guard_staff_login_2: { type: "http", scheme: "bearer", description: "The staff_login guard." },
    });
    expect(first.paths["/api/slash/a"]!.get!.security).toEqual([{ guard_staff_login: [] }]);
    expect(first.paths["/api/underscore/b"]!.get!.security).toEqual([{ guard_staff_login_2: [] }]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(openApi(two).document));
  });

  it("maps query and header properties to parameters, with required from the schema", () => {
    const index = operation("/api/users", "get");
    expect(index.parameters?.map((item) => [item.name, item.in, item.required])).toEqual([
      ["page", "query", false],
      ["tag", "query", false],
      ["x-trace", "header", false],
    ]);
    expect(parameter(index, "tag", "query").schema).toEqual({ type: "array", items: { type: "string" } });
  });

  it("warns for a header OpenAPI reserves, and still documents ordinary headers", () => {
    const contract = defineContract()({
      index: endpoint.get("/").headers(
        z.object({
          Authorization: z.string(),
          "Content-Type": z.string(),
          accept: z.string().optional(),
          "X-Trace": z.string().optional(),
        }),
      ),
    });
    const result = openApi(defineApi({ h: { contract, path: "/api/h", scopes: [] } }));
    const index = result.document.paths["/api/h"]!.get!;
    expect(index.parameters?.map((item) => item.name)).toEqual(["Authorization", "Content-Type", "accept", "X-Trace"]);
    expect(result.warnings).toEqual([
      '"h.index": the header "Authorization" is reserved by OpenAPI; its definition is ignored',
      '"h.index": the header "Content-Type" is reserved by OpenAPI; its definition is ignored',
      '"h.index": the header "accept" is reserved by OpenAPI; its definition is ignored',
    ]);
  });

  it("maps a required query property and a path parameter regex", () => {
    const queryContract = defineContract()({
      index: endpoint.get("/").query(z.object({ limit: z.coerce.number<number>() })),
    });
    const queryDoc = openApi(defineApi({ q: { contract: queryContract, path: "/api/q", scopes: [] } })).document;
    const index = queryDoc.paths["/api/q"]!.get!;
    expect(index.parameters).toEqual([
      { name: "limit", in: "query", required: true, schema: { type: "number" } },
    ]);

    const show = parameter(operation("/api/users/{id}", "get"), "id", "path");
    expect(show.required).toBe(true);
    expect(show.schema).toEqual({ type: "string", pattern: "^(?:[0-9]+)$" });
    // destroy's own `:id` has no pattern: each operation keeps its own segments under the first template's name
    expect(parameter(operation("/api/users/{id}", "delete"), "id", "path").schema).toEqual({ type: "string" });
  });

  it("maps a body to a required JSON requestBody (the schema input)", () => {
    const store = operation("/api/users", "post");
    expect(store.requestBody).toEqual({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { name: { type: "string" }, email: { type: "string" } },
            required: ["name", "email"],
          },
        },
      },
    });
  });

  it("maps the success status, with a response schema (the schema output) only when there is one", () => {
    const index = operation("/api/users", "get").responses["200"]!;
    expect(index.description).toBe("OK");
    expect(content(index)).toMatchObject({
      type: "array",
      items: { type: "object", properties: { id: { type: "number" }, name: { type: "string" } } },
    });
    expect((content(index) as { items: JsonSchema }).items.additionalProperties).toBe(false);

    expect(operation("/api/users", "post").responses["201"]!.description).toBe("Created");
    const destroy = operation("/api/users/{id}", "delete").responses["202"]!;
    expect(destroy).toEqual({ description: "Accepted" });
    expect(operation("/api/v1/health", "get").responses).toEqual({
      "200": {
        description: "OK",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              additionalProperties: false,
            },
          },
        },
      },
    });
  });

  it("groups the derived and declared errors by status, describing their codes", () => {
    expect(Object.keys(operation("/api/users", "get").responses)).toEqual(["200", "401", "422"]);
    expect(operation("/api/users", "get").responses["422"]!.description).toBe("VALIDATION_ERROR");
    expect(content(operation("/api/users", "get").responses["422"]!)).toEqual({
      type: "object",
      required: ["code"],
      properties: { code: { type: "string", enum: ["VALIDATION_ERROR"] } },
      additionalProperties: true,
    });

    expect(Object.keys(operation("/api/users/{id}", "get").responses)).toEqual(["200", "401", "404"]);
    expect(operation("/api/users/{id}", "get").responses["404"]!.description).toBe("NOT_FOUND");

    // two declared errors with the same status share one response, in declaration (call) order
    expect(operation("/api/users", "post").responses["409"]!.description).toBe("EMAIL_TAKEN, USERNAME_TAKEN");
    expect(content(operation("/api/users", "post").responses["409"]!)).toEqual({
      type: "object",
      required: ["code"],
      properties: { code: { type: "string", enum: ["EMAIL_TAKEN", "USERNAME_TAKEN"] } },
      additionalProperties: true,
    });
  });

  it("resolves scope capabilities: authorize(false) drops the 403, the scope throws keep theirs", () => {
    const index = operation("/api/users/{user}/posts", "get");
    expect(index.security).toEqual([{ guard_default: [] }]);
    expect(Object.keys(index.responses)).toEqual(["200", "401", "403", "404", "429"]);
    expect(index.responses["403"]!.description).toBe("ACCOUNT_LOCKED");

    const update = operation("/api/users/{user}/posts/{post}", "patch");
    expect(Object.keys(update.responses)).toEqual(["200", "401", "403", "404", "422", "429"]);
    expect(update.responses["403"]!.description).toBe("FORBIDDEN, ACCOUNT_LOCKED");
    expect(parameter(update, "user", "path").name).toBe("user");
  });

  it("is deterministic: the same routes in another definition order give the same bytes", () => {
    const shared = {
      index: endpoint.get("/").response(User),
      show: endpoint.get("/:id").response(User),
    };
    const first = defineContract()(shared);
    const second = defineContract()({ show: shared.show, index: shared.index });
    const apiA = defineApi({
      a: { contract: first, path: "/api/a", scopes: [] },
      "b.sub": { contract: first, path: "/api/b/sub", scopes: [] },
    });
    const apiB = defineApi({
      "b.sub": { contract: second, path: "/api/b/sub", scopes: [] },
      a: { contract: second, path: "/api/a", scopes: [] },
    });
    expect(JSON.stringify(openApi(apiA).document)).toBe(JSON.stringify(openApi(apiB).document));
    expect(JSON.stringify(openApi(apiA).document)).toBe(JSON.stringify(openApi(apiA).document));
  });

  it("is JSON: no undefined value survives a stringify/parse round trip", () => {
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
    // no schema in this tree refers to itself, so every schema is inline
    expect(refs(doc)).toEqual([]);
    expect(doc.components.schemas).toEqual({});
  });
});

describe("JSON Schema fallbacks", () => {
  it("documents a schema without the Standard JSON Schema extension as {} with a warning", () => {
    const plain: StandardSchemaV1 = {
      "~standard": { version: 1, vendor: "plain", validate: () => ({ value: 1 }) },
    };
    const contract = defineContract()({ show: endpoint.get("/").response(plain) });
    const result = openApi(defineApi({ plain: { contract, path: "/api/plain", scopes: [] } }));
    const show = result.document.paths["/api/plain"]!.get!.responses["200"]!;
    expect(content(show)).toEqual({});
    expect(result.warnings[0]).toMatch(
      /^"plain\.show": the response schema has no JSON Schema \(it has no Standard JSON Schema extension/,
    );
  });

  it("reports the reason a converter throws (zod cannot represent a Date)", () => {
    const contract = defineContract()({
      show: endpoint.get("/").response(z.object({ at: z.date() })),
    });
    const result = openApi(defineApi({ dated: { contract, path: "/api/dated", scopes: [] } }));
    expect(content(result.document.paths["/api/dated"]!.get!.responses["200"]!)).toEqual({});
    expect(result.warnings).toEqual([
      '"dated.show": the response schema has no JSON Schema (Date cannot be represented in JSON Schema); ' +
        "it is documented as {}",
    ]);
  });

  it.each([
    ["null", () => null, "it is not a JSON Schema object (null)"],
    ["an array", () => [1, 2], "it is not a JSON Schema object (an array)"],
    ["a string", () => "no", "it is not a JSON Schema object (string)"],
    ["a number", () => 2, "it is not a JSON Schema object (number)"],
  ])("falls back when the converter returns %s", (_label, convert, reason) => {
    const hostile = {
      "~standard": {
        version: 1,
        vendor: "hostile",
        validate: () => ({ value: 1 }),
        jsonSchema: { input: convert, output: convert },
      },
    } as unknown as StandardSchemaV1;
    const contract = defineContract()({ show: endpoint.get("/").response(hostile) });
    const result = openApi(defineApi({ hostile: { contract, path: "/api/h", scopes: [] } }));
    expect(content(result.document.paths["/api/h"]!.get!.responses["200"]!)).toEqual({});
    expect(result.warnings[0]).toContain(`the response schema has no JSON Schema (${reason})`);
  });

  it("falls back on a cyclic conversion and on a throwing ~standard accessor", () => {
    const cyclic: Record<string, unknown> = { type: "object" };
    cyclic.self = cyclic;
    const cyclicSchema = {
      "~standard": {
        version: 1,
        vendor: "cyclic",
        validate: () => ({ value: 1 }),
        jsonSchema: { input: () => cyclic, output: () => cyclic },
      },
    } as unknown as StandardSchemaV1;
    const cyclicContract = defineContract()({ show: endpoint.get("/").response(cyclicSchema) });
    const cyclicResult = openApi(defineApi({ cyclic: { contract: cyclicContract, path: "/api/c", scopes: [] } }));
    expect(content(cyclicResult.document.paths["/api/c"]!.get!.responses["200"]!)).toEqual({});
    expect(cyclicResult.warnings[0]).toContain("Converting circular structure to JSON");
    // the V8 message is multi-line: the warning is printed on one line
    expect(cyclicResult.warnings[0]).not.toContain("\n");

    const throwing = Object.defineProperty({}, "~standard", {
      get() {
        throw new Error("no accessor for you");
      },
    }) as StandardSchemaV1;
    const throwingContract = defineContract()({ show: endpoint.get("/").response(throwing) });
    const throwingResult = openApi(defineApi({ trap: { contract: throwingContract, path: "/api/t", scopes: [] } }));
    expect(content(throwingResult.document.paths["/api/t"]!.get!.responses["200"]!)).toEqual({});
    expect(throwingResult.warnings[0]).toContain("(no accessor for you)");
  });

  it("warns and documents a query schema whose conversion failed, and a non-object property", () => {
    const broken = {
      "~standard": {
        version: 1,
        vendor: "broken",
        validate: () => ({ value: 1 }),
        jsonSchema: { input: () => ({ type: "object", properties: { bad: 5 } }) },
      },
    } as unknown as StandardSchemaV1;
    const contract = defineContract()({ index: endpoint.get("/").query(broken) });
    const result = openApi(defineApi({ broken: { contract, path: "/api/broken", scopes: [] } }));
    expect(result.document.paths["/api/broken"]!.get!.parameters).toEqual([
      { name: "bad", in: "query", required: false, schema: {} },
    ]);
    expect(result.warnings).toEqual([
      '"broken.index": the query property "bad" is not a JSON Schema object; it is documented as {}',
    ]);

    const missing = {
      "~standard": { version: 1, vendor: "missing", validate: () => ({ value: 1 }) },
    } as StandardSchemaV1;
    const noSchema = defineContract()({ index: endpoint.get("/").query(missing) });
    const noSchemaResult = openApi(defineApi({ missing: { contract: noSchema, path: "/api/missing", scopes: [] } }));
    expect(noSchemaResult.document.paths["/api/missing"]!.get!.parameters).toBeUndefined();
    expect(noSchemaResult.warnings[0]).toMatch(
      /^"missing\.index": the query schema has no JSON Schema .* the query parameters are not documented$/,
    );
  });
});

describe("warning hygiene", () => {
  it("keeps a multi-line conversion error on one line", () => {
    const multiline = {
      "~standard": {
        version: 1,
        vendor: "multiline",
        validate: () => ({ value: 1 }),
        jsonSchema: {
          input: () => {
            throw new Error("first line\nsecond line\tthird");
          },
          output: () => {
            throw new Error("first line\nsecond line");
          },
        },
      },
    } as unknown as StandardSchemaV1;
    const contract = defineContract()({ show: endpoint.get("/").response(multiline) });
    const result = openApi(defineApi({ ml: { contract, path: "/api/ml", scopes: [] } }));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("(first line second line)");
    expect(result.warnings[0]).not.toContain("\n");
  });

  it("escapes control characters and ANSI escapes in route and property names", () => {
    const route = `evil.\u0001route\u001b[31m`;
    const control = "\u0001prop";
    const ansi = "\u001b[31mred\u001b[0m";
    const hostile = {
      "~standard": {
        version: 1,
        vendor: "hostile-names",
        validate: () => ({ value: 1 }),
        jsonSchema: {
          input: () => ({ type: "object", properties: { [control]: 5, [ansi]: 5 } }),
        },
      },
    } as unknown as StandardSchemaV1;
    const contract = defineContract()({ ["\u0001route\u001b[31m"]: endpoint.get("/").query(hostile) });
    const result = openApi(defineApi({ evil: { contract, path: "/api/evil", scopes: [] } }));
    expect(result.warnings).toHaveLength(2);
    for (const warning of result.warnings) {
      expect(warning).toContain(JSON.stringify(route));
      expect(warning).not.toContain("\u0001");
      expect(warning).not.toContain("\u001b");
    }
    expect(result.warnings[0]).toContain(JSON.stringify(control));
    expect(result.warnings[1]).toContain(JSON.stringify(ansi));
  });

  it("escapes control characters in a converter's reason, not only in quoted names", () => {
    const hostile = {
      "~standard": {
        version: 1,
        vendor: "hostile-reason",
        validate: () => ({ value: 1 }),
        jsonSchema: {
          input: () => {
            throw new Error("bad \u0001 and \u001b[31mred\u001b[0m");
          },
          output: () => {
            throw new Error("bad \u0001 and \u001b[31mred\u001b[0m");
          },
        },
      },
    } as unknown as StandardSchemaV1;
    const contract = defineContract()({ show: endpoint.get("/").response(hostile) });
    const result = openApi(defineApi({ r: { contract, path: "/api/r", scopes: [] } }));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("bad \\u0001 and \\u001b[31mred\\u001b[0m");
    expect(result.warnings[0]).not.toContain("\u0001");
    expect(result.warnings[0]).not.toContain("\u001b");
  });

  it("escapes control characters in a duplicate-route warning", () => {
    const control = "\u0001one";
    const ansi = "\u001b[32mtwo";
    const first = defineContract()({ [control]: endpoint.get("/:a") });
    const second = defineContract()({ [ansi]: endpoint.get("/:b") });
    const api = defineApi({
      first: { contract: first, path: "/api/x", scopes: [] },
      second: { contract: second, path: "/api/x", scopes: [] },
    });
    const result = openApi(api);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(JSON.stringify(`second.${ansi}`));
    expect(result.warnings[0]).toContain(JSON.stringify(`first.${control}`));
    expect(result.warnings[0]).not.toContain("\u0001");
    expect(result.warnings[0]).not.toContain("\u001b");
  });
});

describe("recursive schemas", () => {
  type Node = { name: string; children: Node[] };
  const NodeDto: z.ZodType<Node> = z.object({
    name: z.string(),
    get children() {
      return z.array(NodeDto);
    },
  });

  it("hoists a recursive response into a component and rebases its self-ref", () => {
    const contract = defineContract()({ tree: endpoint.get("/").response(NodeDto) });
    const result = openApi(defineApi({ tree: { contract, path: "/api/tree", scopes: [] } }));
    const body = content(result.document.paths["/api/tree"]!.get!.responses["200"]!)!;
    expect(body).toEqual({ $ref: "#/components/schemas/tree.tree.response" });
    const component = result.document.components.schemas["tree.tree.response"]!;
    expect(component).toMatchObject({ type: "object", properties: { name: { type: "string" } } });
    expect((component.properties as { children: { items: JsonSchema } }).children.items).toEqual({
      $ref: "#/components/schemas/tree.tree.response",
    });
    expect(refs(result.document).every((ref) => ref.startsWith("#/components/schemas/"))).toBe(true);
  });

  it("hoists the query schema once and points the parameter at the property's original location", () => {
    const contract = defineContract()({
      index: endpoint.get("/").query(z.object({ tree: NodeDto })),
    });
    const result = openApi(defineApi({ q: { contract, path: "/api/q", scopes: [] } }));
    const index = result.document.paths["/api/q"]!.get!;
    expect(index.parameters).toEqual([
      {
        name: "tree",
        in: "query",
        required: true,
        schema: { $ref: "#/components/schemas/q.index.query/properties/tree" },
      },
    ]);
    // zod's nested recursion is a root $ref into $defs; the hoisted root keeps the property's base and definitions
    const component = result.document.components.schemas["q.index.query"]!;
    expect(component.properties).toMatchObject({ tree: { $ref: "#/components/schemas/q.index.query/$defs/__schema0" } });
    const defs = component.$defs as Record<string, JsonSchema>;
    expect(defs.__schema0).toMatchObject({ type: "object" });
    expect((refs(result.document)).every((ref) => ref.startsWith("#/components/schemas/"))).toBe(true);
  });

  it("escapes ~ and / in a hoisted query property's JSON Pointer", () => {
    const escaped = {
      "~standard": {
        version: 1,
        vendor: "escaped-pointer",
        validate: () => ({ value: 1 }),
        jsonSchema: {
          input: () => ({
            type: "object",
            properties: {
              "a/b": { $ref: "#/$defs/x" },
              "a~b": { $ref: "#/$defs/x" },
            },
            $defs: { x: { type: "string" } },
          }),
        },
      },
    } as unknown as StandardSchemaV1;
    const contract = defineContract()({ index: endpoint.get("/").query(escaped) });
    const result = openApi(defineApi({ p: { contract, path: "/api/p", scopes: [] } }));
    expect(result.document.paths["/api/p"]!.get!.parameters).toEqual([
      {
        name: "a/b",
        in: "query",
        required: false,
        schema: { $ref: "#/components/schemas/p.index.query/properties/a~1b" },
      },
      {
        name: "a~b",
        in: "query",
        required: false,
        schema: { $ref: "#/components/schemas/p.index.query/properties/a~0b" },
      },
    ]);
    expect(result.document.components.schemas["p.index.query"]).toMatchObject({
      properties: {
        "a/b": { $ref: "#/components/schemas/p.index.query/$defs/x" },
        "a~b": { $ref: "#/components/schemas/p.index.query/$defs/x" },
      },
      $defs: { x: { type: "string" } },
    });
    expect(JSON.parse(JSON.stringify(result.document))).toEqual(result.document);
  });

  it("keeps a property's root reference to the query schema itself", () => {
    const selfRef = {
      "~standard": {
        version: 1,
        vendor: "self-ref",
        validate: () => ({ value: 1 }),
        jsonSchema: {
          input: () => ({
            type: "object",
            properties: {
              name: { type: "string" },
              tree: { type: "array", items: { $ref: "#" } },
            },
          }),
        },
      },
    } as unknown as StandardSchemaV1;
    const contract = defineContract()({ index: endpoint.get("/").query(selfRef) });
    const result = openApi(defineApi({ q: { contract, path: "/api/q", scopes: [] } }));
    expect(result.document.paths["/api/q"]!.get!.parameters).toEqual([
      { name: "name", in: "query", required: false, schema: { type: "string" } },
      {
        name: "tree",
        in: "query",
        required: false,
        schema: { $ref: "#/components/schemas/q.index.query/properties/tree" },
      },
    ]);
    // `#` in the item still means the query object, not the hoisted array property it came from
    expect(result.document.components.schemas["q.index.query"]).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string" },
        tree: { type: "array", items: { $ref: "#/components/schemas/q.index.query" } },
      },
    });
  });

  it("resolves a named anchor against the source schema's own resource when hoisting", () => {
    const anchored = {
      "~standard": {
        version: 1,
        vendor: "anchored",
        validate: () => ({ value: 1 }),
        jsonSchema: {
          input: () => ({
            type: "object",
            properties: { item: { $ref: "#node" }, root: { $ref: "#" } },
            $defs: { node: { $anchor: "node", type: "string" } },
          }),
          output: () => ({
            type: "object",
            properties: { item: { $ref: "#node" }, root: { $ref: "#" } },
            $defs: { node: { $anchor: "node", type: "string" } },
          }),
        },
      },
    } as unknown as StandardSchemaV1;
    const contract = defineContract()({ show: endpoint.get("/").response(anchored) });
    const result = openApi(defineApi({ a: { contract, path: "/api/a", scopes: [] } }));
    expect(content(result.document.paths["/api/a"]!.get!.responses["200"]!)).toEqual({
      $ref: "#/components/schemas/a.show.response",
    });
    const component = result.document.components.schemas["a.show.response"]!;
    expect(component.properties).toEqual({
      item: { $ref: "#/components/schemas/a.show.response/$defs/node" },
      root: { $ref: "#/components/schemas/a.show.response" },
    });
    expect(refs(result.document).every((ref) => ref.startsWith("#/components/schemas/"))).toBe(true);
  });

  it("rebases a registered schema's root $ref and keeps its $defs reachable", () => {
    const registered = z.object({ id: z.number() });
    z.globalRegistry.add(registered, { id: "registered-user" });
    const contract = defineContract()({ show: endpoint.get("/").response(registered) });
    const result = openApi(defineApi({ reg: { contract, path: "/api/reg", scopes: [] } }));
    const body = content(result.document.paths["/api/reg"]!.get!.responses["200"]!)!;
    expect(body).toEqual({ $ref: "#/components/schemas/reg.show.response" });
    expect(result.document.components.schemas["reg.show.response"]).toMatchObject({
      $ref: "#/components/schemas/reg.show.response/$defs/registered-user",
      $defs: { "registered-user": { type: "object", properties: { id: { type: "number" } } } },
    });
  });

  it("keeps a schema with its own root $id inline, since its refs resolve against that resource", () => {
    const resource = {
      "~standard": {
        version: 1,
        vendor: "resource",
        validate: () => ({ value: 1 }),
        jsonSchema: {
          input: () => ({
            $id: "https://example.com/node",
            type: "object",
            properties: { self: { $ref: "#" }, legacy: { $ref: "#/components/schemas/$0" } },
          }),
          output: () => ({
            $id: "https://example.com/node",
            type: "object",
            properties: { self: { $ref: "#" }, legacy: { $ref: "#/components/schemas/$0" } },
          }),
        },
      },
    } as unknown as StandardSchemaV1;
    const contract = defineContract()({ show: endpoint.get("/").response(resource) });
    const result = openApi(defineApi({ res: { contract, path: "/api/res", scopes: [] } }));
    expect(content(result.document.paths["/api/res"]!.get!.responses["200"]!)).toEqual({
      $id: "https://example.com/node",
      type: "object",
      // the generator only rewrites its own provisional keys (marked with NUL): a schema's own ref is left alone
      properties: { self: { $ref: "#" }, legacy: { $ref: "#/components/schemas/$0" } },
    });
    expect(result.document.components.schemas).toEqual({});
  });
});

describe("paths OpenAPI cannot tell apart", () => {
  it("merges different methods on templates that differ only by a parameter name", () => {
    const get = defineContract()({ get: endpoint.get("/:a") });
    const post = defineContract()({ post: endpoint.post("/:b") });
    const api = defineApi({
      get: { contract: get, path: "/api/x", scopes: [] },
      post: { contract: post, path: "/api/x", scopes: [] },
    });
    const result = openApi(api);
    const item = result.document.paths["/api/x/{a}"]!;
    expect(Object.keys(item)).toEqual(["get", "post"]);
    expect(item.get!.parameters).toEqual([{ name: "a", in: "path", required: true, schema: { type: "string" } }]);
    // the second operation's path parameter is renamed to the template's name
    expect(item.post!.parameters).toEqual([{ name: "a", in: "path", required: true, schema: { type: "string" } }]);
    expect(item.post!.summary).toBe("POST /api/x/{a}");
    expect(result.warnings).toEqual([]);
  });

  it("keeps the first of two routes with the same method and template, with a warning", () => {
    const first = defineContract()({ one: endpoint.get("/:a") });
    const second = defineContract()({ two: endpoint.get("/:b") });
    const api = defineApi({
      first: { contract: first, path: "/api/x", scopes: [] },
      second: { contract: second, path: "/api/x", scopes: [] },
    });
    const result = openApi(api);
    expect(Object.keys(result.document.paths["/api/x/{a}"]!)).toEqual(["get"]);
    expect(result.document.paths["/api/x/{a}"]!.get!.operationId).toBe("first.one");
    // the two paths match the same requests, so tree order is only the document's tie-breaker
    expect(result.warnings).toEqual([
      '"second.two" and "first.one" both answer GET /api/x/{a}; keeping "first.one" (first in tree order)',
    ]);
  });

  it("drops a same-method route whose param differs only by a regex, and says what is not described", () => {
    const contract = defineContract()({
      plain: endpoint.get("/:id"),
      patterned: endpoint.get("/:id{[0-9]+}"),
    });
    const result = openApi(defineApi({ pattern: { contract, path: "/api/x", scopes: [] } }));
    expect(result.document.paths["/api/x/{id}"]!.get!.operationId).toBe("pattern.plain");
    // the router does not use tree order here: it answers /api/x/42 with the constrained route, which the retained
    // operation does not describe; the warning names it instead of claiming the router keeps the first route
    expect(result.warnings).toEqual([
      '"pattern.patterned" and "pattern.plain" both answer GET /api/x/{id}; keeping "pattern.plain" (first in tree order); requests that the router answers with "pattern.patterned" ("/api/x/:id{[0-9]+}") are not described by the retained operation',
    ]);
  });
});

describe("hostile contract input", () => {
  it.each([
    null,
    undefined,
    1,
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "x",
    [],
    { length: 1e9 },
    Object.fromEntries([["__proto__", 1]]),
  ])("rejects an appApi that is not a defineApi root (%#)", (api) => {
    expect(() => openApi(api as unknown as object)).toThrow(OpenApiGenerationError);
    expect(() => openApi(api as unknown as object)).toThrow(
      "[sauf openapi:generate] the appApi must be the root that defineApi returns",
    );
  });

  it("rejects a missing contract runtime instead of a TypeError", () => {
    expect(() => generateOpenApiDocument({}, {} as never)).toThrow(
      "[sauf openapi:generate] options.contract must provide apiRoutes() and isApiRoot()",
    );
    expect(() => generateOpenApiDocument({}, undefined as never)).toThrow(
      "[sauf openapi:generate] options.contract must provide apiRoutes() and isApiRoot()",
    );
  });

  it("falls back for wrong-typed info metadata and keeps a lone surrogate and a 10k name in JSON", () => {
    type Node = { name: string; children: Node[] };
    const NodeDto: z.ZodType<Node> = z.object({
      name: z.string(),
      get children() {
        return z.array(NodeDto);
      },
    });
    const longName = "n".repeat(10_000);
    const contract = defineContract()({
      ["\ud800"]: endpoint.get("/lone").response(NodeDto),
      [longName]: endpoint.get("/long-name").response(NodeDto),
    });
    const result = openApi(defineApi({ names: { contract, path: "/api/names", scopes: [] } }), {
      title: 5 as unknown as string,
      version: null as unknown as string,
    });
    expect(result.document.info).toEqual({ title: "Laratype API", version: "0.0.0" });
    const ids = Object.values(result.document.paths).map((item) => item.get!.operationId);
    expect(ids).toContain("names.\ud800");
    expect(ids).toContain(`names.${longName}`);
    expect(JSON.parse(JSON.stringify(result.document))).toEqual(result.document);
  });

  it("treats a non-JSON-schema response value as a fallback, and rejects NaN/Infinity bounds", () => {
    const forged = endpoint.get("/forged").response(null as unknown as StandardSchemaV1);
    const contract = defineContract()({ forged });
    const result = openApi(defineApi({ forged: { contract, path: "/api/x", scopes: [] } }));
    expect(content(result.document.paths["/api/x/forged"]!.get!.responses["200"]!)).toEqual({});
    expect(result.warnings[0]).toContain(
      "the response schema has no JSON Schema (it has no Standard JSON Schema extension",
    );

    const numbers = {
      "~standard": {
        version: 1,
        vendor: "numbers",
        validate: () => ({ value: 1 }),
        jsonSchema: {
          input: () => ({ type: "number" }),
          output: () => ({ type: "number", minimum: Number.NaN, maximum: Number.POSITIVE_INFINITY }),
        },
      },
    } as unknown as StandardSchemaV1;
    const numbersContract = defineContract()({ show: endpoint.get("/").response(numbers) });
    const numbersResult = openApi(
      defineApi({ numbers: { contract: numbersContract, path: "/api/numbers", scopes: [] } }),
    );
    // draft 2020-12 requires finite numbers in these keywords: the schema falls back instead of emitting null
    expect(content(numbersResult.document.paths["/api/numbers"]!.get!.responses["200"]!)).toEqual({});
    expect(numbersResult.warnings).toEqual([
      '"numbers.show": the response schema has no JSON Schema (it has a minimum (number) that is not a finite number); it is documented as {}',
    ]);
  });

  it("does not depend on an enumerable ~standard", () => {
    const schemaObject = { type: "string" };
    const hidden = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hidden, "~standard", {
      value: {
        version: 1,
        vendor: "hidden",
        validate: () => ({ value: 1 }),
        jsonSchema: { input: () => schemaObject, output: () => schemaObject },
      },
      enumerable: false,
    });
    const contract = defineContract()({ show: endpoint.get("/").response(hidden as unknown as StandardSchemaV1) });
    const hiddenResult = openApi(defineApi({ hidden: { contract, path: "/api/hidden", scopes: [] } }));
    expect(content(hiddenResult.document.paths["/api/hidden"]!.get!.responses["200"]!)).toEqual({ type: "string" });
  });

  it("gives colliding sanitized component keys the same names in any definition order", () => {
    type Node = { name: string; children: Node[] };
    const NodeDto: z.ZodType<Node> = z.object({
      name: z.string(),
      get children() {
        return z.array(NodeDto);
      },
    });
    const contract = defineContract()({ show: endpoint.get("/").response(NodeDto) });
    const one = defineApi({
      ["a b"]: { contract, path: "/api/one", scopes: [] },
      ["a_b"]: { contract, path: "/api/two", scopes: [] },
    });
    const two = defineApi({
      ["a_b"]: { contract, path: "/api/two", scopes: [] },
      ["a b"]: { contract, path: "/api/one", scopes: [] },
    });
    const first = openApi(one).document;
    const second = openApi(two).document;
    expect(Object.keys(first.components.schemas)).toEqual(["a_b.show.response", "a_b.show.response_2"]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("rejects a malformed error entry before response assembly, and accepts an empty errors array", () => {
    const routeWith = (errors: unknown) =>
      ({
        apiRoutes: () => [
          { name: "a", method: "get", path: "/a", endpoint: { def: { status: 200 } }, errors },
        ],
        isApiRoot: () => true,
      }) as unknown as OpenApiContract;
    for (const errors of [
      [null],
      [undefined],
      [{}],
      [{ status: 400 }],
      [{ status: 400, code: "" }],
      [{ status: Number.NaN, code: "X" }],
      [{ status: 200, code: "X" }],
      [{ status: 400, code: 5 }],
    ]) {
      expect(() => generateOpenApiDocument({}, { contract: routeWith(errors) })).toThrow(
        "[sauf openapi:generate] apiRoutes() returned an invalid route",
      );
    }
    // an empty array is valid: a route with no errors (the contract always derives some, but a custom runtime may not)
    const empty = generateOpenApiDocument({}, { contract: routeWith([]) });
    expect(empty.document.paths["/a"]!.get!.operationId).toBe("a");
    // an object with a valid status and code is accepted like an ErrorDef function
    const objectEntries = generateOpenApiDocument({}, { contract: routeWith([{ status: 409, code: "TAKEN" }]) });
    expect(objectEntries.document.paths["/a"]!.get!.responses["409"]!.description).toBe("TAKEN");
  });

  it("handles a very long regex pattern and a wrong contract runtime with one diagnostic", () => {
    const pattern = "a".repeat(10_000);
    const contract = defineContract()({ show: endpoint.get(`/:id{${pattern}}`) });
    const result = openApi(defineApi({ re: { contract, path: "/api/re", scopes: [] } }));
    expect(result.document.paths["/api/re/{id}"]!.get!.parameters![0]!.schema).toEqual({
      type: "string",
      pattern: `^(?:${pattern})$`,
    });

    const notArray = { apiRoutes: () => ({}), isApiRoot: () => true } as unknown as OpenApiContract;
    expect(() => generateOpenApiDocument({}, { contract: notArray })).toThrow(
      "[sauf openapi:generate] apiRoutes() must return an array of routes",
    );
    const badRoute = { apiRoutes: () => [{}], isApiRoot: () => true } as unknown as OpenApiContract;
    expect(() => generateOpenApiDocument({}, { contract: badRoute })).toThrow(
      "[sauf openapi:generate] apiRoutes() returned an invalid route",
    );
    const badMethod = {
      apiRoutes: () => [{ name: "a", method: "head", path: "/a", endpoint: { def: {} }, errors: [] }],
      isApiRoot: () => true,
    } as unknown as OpenApiContract;
    expect(() => generateOpenApiDocument({}, { contract: badMethod })).toThrow(
      "[sauf openapi:generate] apiRoutes() returned an invalid route",
    );
  });

  it("keeps a trailing slash and a wildcard as written", () => {
    const contract = defineContract()({
      slash: endpoint.get("/items/"),
      wildcard: endpoint.get("/files/*"),
    });
    const result = openApi(defineApi({ tail: { contract, path: "/api/tail", scopes: [] } }));
    expect(Object.keys(result.document.paths)).toEqual(["/api/tail/files/*", "/api/tail/items/"]);
  });

  it("keeps a __proto__ endpoint key and a __proto__ query property as own data, not the prototype", () => {
    const contract = defineContract()({
      ["__proto__"]: endpoint.get("/guard"),
    } as unknown as { show: ReturnType<typeof endpoint.get> });
    const query = {
      "~standard": {
        version: 1,
        vendor: "proto",
        validate: () => ({ value: 1 }),
        jsonSchema: {
          input: () => JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'),
        },
      },
    } as unknown as StandardSchemaV1;
    const protoContract = defineContract()({ index: endpoint.get("/").query(query) });
    const api = defineApi({
      x: { contract, path: "/api/x", scopes: [] },
      y: { contract: protoContract, path: "/api/y", scopes: [] },
    });
    const result = openApi(api);
    expect(result.document.paths["/api/x/guard"]!.get!.operationId).toBe("x.__proto__");
    expect(Object.hasOwn(result.document.paths, "/api/x/guard")).toBe(true);
    expect(({} as Record<string, unknown>).guard).toBeUndefined();
    expect(Object.getPrototypeOf(result.document.paths)).toBe(Object.prototype);
    expect(result.document.paths["/api/y"]!.get!.parameters).toEqual([
      { name: "__proto__", in: "query", required: false, schema: { type: "string" } },
    ]);
  });

  it("keeps unicode and control characters in operationIds and sanitizes component keys", () => {
    type Node = { name: string; children: Node[] };
    const NodeDto: z.ZodType<Node> = z.object({
      name: z.string(),
      get children() {
        return z.array(NodeDto);
      },
    });
    const contract = defineContract()({
      ["\u0001"]: endpoint.get("/control").response(NodeDto),
      ["💥"]: endpoint.get("/boom").response(NodeDto),
      ["a b"]: endpoint.get("/space").response(NodeDto),
      ["a_b"]: endpoint.get("/underscore").response(NodeDto),
    });
    const result = openApi(defineApi({ weird: { contract, path: "/api/weird", scopes: [] } }));
    const ids = Object.values(result.document.paths).map((item) => item.get!.operationId);
    expect(ids).toEqual(expect.arrayContaining(["weird.\u0001", "weird.💥", "weird.a b", "weird.a_b"]));
    const keys = Object.keys(result.document.components.schemas);
    expect(keys).toHaveLength(4);
    expect(keys.every((key) => /^[A-Za-z0-9._-]+$/.test(key))).toBe(true);
    expect(new Set(keys).size).toBe(4);
    expect(JSON.parse(JSON.stringify(result.document)).paths).toEqual(result.document.paths);
  });

  it("handles a very long path and a path param name with a brace", () => {
    const long = `/${"a".repeat(10_000)}`;
    const contract = defineContract()({
      long: endpoint.get(long),
      brace: endpoint.get("/:a}b"),
    });
    const result = openApi(defineApi({ edge: { contract, path: "/api/edge", scopes: [] } }));
    const path = `/api/edge${long}`;
    expect(Object.hasOwn(result.document.paths, path)).toBe(true);
    expect(result.document.paths[path]!.get!.summary).toBe(`GET ${path}`);
    expect(result.document.paths["/api/edge/{a_b}"]!.get!.parameters).toEqual([
      { name: "a_b", in: "path", required: true, schema: { type: "string" } },
    ]);
  });

  it("encodes literal braces and query delimiters in a path template", () => {
    const contract = defineContract()({
      braces: endpoint.get("/a{b}"),
      question: endpoint.get("/a?b"),
      hash: endpoint.get("/a#b"),
    });
    const result = openApi(defineApi({ enc: { contract, path: "/api/enc", scopes: [] } }));
    expect(Object.keys(result.document.paths)).toEqual(["/api/enc/a%23b", "/api/enc/a%3Fb", "/api/enc/a%7Bb%7D"]);
  });

  it("marks an optional path parameter required with a description (OpenAPI has no optional ones)", () => {
    const plain = defineContract()({ show: endpoint.get("/:id?") });
    const patterned = defineContract()({ show: endpoint.get("/:slug{[a-z]+}?") });
    const expected = (name: string, schema: JsonSchema) => [
      {
        name,
        in: "path",
        required: true,
        description: "optional path parameter: the router also matches the path without this segment",
        schema,
      },
    ];
    const plainResult = openApi(defineApi({ opt: { contract: plain, path: "/api/plain", scopes: [] } }));
    expect(plainResult.document.paths["/api/plain/{id}"]!.get!.parameters).toEqual(expected("id", { type: "string" }));
    const patternedResult = openApi(defineApi({ opt: { contract: patterned, path: "/api/pattern", scopes: [] } }));
    expect(patternedResult.document.paths["/api/pattern/{slug}"]!.get!.parameters).toEqual(
      expected("slug", { type: "string", pattern: "^(?:[a-z]+)$" }),
    );
  });
});
