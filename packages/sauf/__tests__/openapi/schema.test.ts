import * as z from "zod";
import { describe, expect, it } from "vitest";
import {
  errorReason,
  hasLocalRefs,
  isParentRef,
  isSchemaResource,
  oneLine,
  rebaseRefs,
  standardJsonSchema,
} from "../../src/openapi/schema";

describe("standardJsonSchema", () => {
  it("converts a zod schema and drops the root $schema (the document declares its dialect)", () => {
    const result = standardJsonSchema(z.object({ name: z.string() }), "output");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.schema).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });
    expect(result.schema.$schema).toBeUndefined();
  });

  it("uses input for a request and output for a response", () => {
    const schema = z.object({ name: z.string() });
    const input = standardJsonSchema(schema, "input");
    const output = standardJsonSchema(schema, "output");
    expect(input.ok).toBe(true);
    expect(output.ok).toBe(true);
    if (!input.ok || !output.ok) throw new Error("zod must convert both");
    expect(input.schema.additionalProperties).toBeUndefined();
    expect(output.schema.additionalProperties).toBe(false);
  });

  it("reports a missing extension, a throw, a non-object and a cycle", () => {
    const plain = { "~standard": { version: 1, vendor: "plain", validate: () => ({ value: 1 }) } };
    expect(standardJsonSchema(plain, "input")).toEqual({
      ok: false,
      reason: "it has no Standard JSON Schema extension (~standard.jsonSchema; zod 4 has one)",
    });

    const throwing = {
      "~standard": {
        version: 1,
        vendor: "throwing",
        validate: () => ({ value: 1 }),
        jsonSchema: { input: () => { throw new Error("boom"); }, output: () => { throw "a string"; } },
      },
    };
    expect(standardJsonSchema(throwing, "input")).toEqual({ ok: false, reason: "boom" });
    expect(standardJsonSchema(throwing, "output")).toEqual({ ok: false, reason: "a string" });

    const returns = (value: unknown) => ({
      "~standard": {
        version: 1,
        vendor: "returns",
        validate: () => ({ value: 1 }),
        jsonSchema: { input: () => value },
      },
    });
    expect(standardJsonSchema(returns(null), "input")).toEqual({
      ok: false,
      reason: "it is not a JSON Schema object (null)",
    });
    expect(standardJsonSchema(returns([1]), "input")).toEqual({
      ok: false,
      reason: "it is not a JSON Schema object (an array)",
    });
    expect(standardJsonSchema(returns("x"), "input")).toEqual({
      ok: false,
      reason: "it is not a JSON Schema object (string)",
    });
    expect(standardJsonSchema(returns(() => "x"), "input")).toEqual({ ok: false, reason: "it is not JSON (function)" });

    const cyclic: Record<string, unknown> = { type: "object" };
    cyclic.self = cyclic;
    expect(standardJsonSchema(returns(cyclic), "input")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("circular"),
    });
  });

  it("reports a non-function converter", () => {
    const value = {
      "~standard": { version: 1, vendor: "weird", validate: () => ({ value: 1 }), jsonSchema: { input: 1 } },
    };
    expect(standardJsonSchema(value, "input").ok).toBe(false);
  });

  it("rejects a non-finite numeric bound instead of letting JSON turn it into null", () => {
    const schemaFor = (minimum: unknown) => ({
      "~standard": {
        version: 1,
        vendor: "bounds",
        validate: () => ({ value: 1 }),
        jsonSchema: { input: () => ({ type: "number", minimum }), output: () => ({ type: "number", minimum }) },
      },
    });
    // finite bounds and a schema without a bound are unchanged
    expect(standardJsonSchema(schemaFor(0), "input")).toEqual({ ok: true, schema: { type: "number", minimum: 0 } });
    expect(standardJsonSchema(schemaFor(Number.NEGATIVE_INFINITY), "input")).toEqual({
      ok: false,
      reason: "it has a minimum (number) that is not a finite number",
    });
    expect(standardJsonSchema(schemaFor(Number.NaN), "output")).toEqual({
      ok: false,
      reason: "it has a minimum (number) that is not a finite number",
    });
    // only a non-finite number is rejected: a non-number stays the schema library's dialect's problem
    expect(standardJsonSchema(schemaFor("1"), "input")).toEqual({ ok: true, schema: { type: "number", minimum: "1" } });
    // a draft-04 boolean exclusiveMinimum is not a non-finite number either
    const booleanBound = {
      "~standard": {
        version: 1,
        vendor: "draft04",
        validate: () => ({ value: 1 }),
        jsonSchema: { input: () => ({ type: "number", exclusiveMinimum: true }) },
      },
    };
    expect(standardJsonSchema(booleanBound, "input")).toEqual({
      ok: true,
      schema: { type: "number", exclusiveMinimum: true },
    });
    // a nested bound is found too, and each numeric keyword is checked
    const nested = {
      "~standard": {
        version: 1,
        vendor: "nested",
        validate: () => ({ value: 1 }),
        jsonSchema: { input: () => ({ type: "object", properties: { n: { type: "number", multipleOf: Infinity } } }) },
      },
    };
    expect(standardJsonSchema(nested, "input")).toEqual({
      ok: false,
      reason: "it has a multipleOf (number) that is not a finite number",
    });
    // the integer keywords are checked the same way
    for (const keyword of [
      "maxLength",
      "minLength",
      "maxItems",
      "minItems",
      "maxProperties",
      "minProperties",
      "maxContains",
      "minContains",
    ]) {
      const integer = {
        "~standard": {
          version: 1,
          vendor: "integer",
          validate: () => ({ value: 1 }),
          jsonSchema: { input: () => ({ type: "array", [keyword]: Number.POSITIVE_INFINITY }) },
        },
      };
      expect(standardJsonSchema(integer, "input")).toEqual({
        ok: false,
        reason: `it has a ${keyword} (number) that is not a finite number`,
      });
    }
  });
});

describe("refs", () => {
  it("finds local refs and skips a subtree with its own $id", () => {
    expect(hasLocalRefs({ type: "string" })).toBe(false);
    expect(hasLocalRefs({ $ref: "#" })).toBe(true);
    expect(hasLocalRefs({ items: { $ref: "#/$defs/x" } })).toBe(true);
    expect(hasLocalRefs({ items: { $ref: "https://example.com/x" } })).toBe(false);
    // a root $id makes the whole schema a resource: its "#" refs already resolve
    expect(hasLocalRefs({ $id: "https://example.com/x", properties: { self: { $ref: "#" } } })).toBe(false);
    // a nested $id starts a resource of its own
    expect(hasLocalRefs({ properties: { nested: { $id: "https://example.com/n", self: { $ref: "#" } } } })).toBe(false);
    expect(isSchemaResource({ $id: "x" })).toBe(true);
    expect(isSchemaResource({ $id: 2 })).toBe(false);
  });

  it("rebases local refs on the component and clones the schema", () => {
    const source = {
      type: "object",
      properties: {
        self: { $ref: "#" },
        child: { $ref: "#/$defs/child" },
        external: { $ref: "https://example.com/x" },
      },
      $defs: { child: { type: "string" } },
    };
    const copy = rebaseRefs(source, "x.response");
    expect(copy).toEqual({
      type: "object",
      properties: {
        self: { $ref: "#/components/schemas/x.response" },
        child: { $ref: "#/components/schemas/x.response/$defs/child" },
        external: { $ref: "https://example.com/x" },
      },
      $defs: { child: { type: "string" } },
    });
    expect(source.properties.self.$ref).toBe("#");
  });

  it("leaves a nested $id subtree's refs alone", () => {
    const copy = rebaseRefs({ properties: { n: { $id: "https://e/n", self: { $ref: "#" } } } }, "k");
    const properties = copy.properties as Record<string, { self: { $ref: string } }>;
    expect(properties.n!.self).toEqual({ $ref: "#" });
  });

  it("leaves $ref-shaped keys under const, enum, default and examples as instance values", () => {
    const instance = { const: { $ref: "#" }, default: { $ref: "#/$defs/x" }, examples: [{ $ref: "#item" }] };
    expect(hasLocalRefs({ ...instance, enum: [{ $ref: "#/$defs/x" }] })).toBe(false);
    expect(rebaseRefs(instance, "k")).toEqual(instance);
    // a ref in a real subschema is still found and rebased, next to the untouched instances
    const schema = { properties: { a: { $ref: "#/$defs/x" } }, ...instance, $defs: { x: { type: "string" } } };
    expect(hasLocalRefs(schema)).toBe(true);
    expect(rebaseRefs(schema, "k")).toEqual({
      properties: { a: { $ref: "#/components/schemas/k/$defs/x" } },
      ...instance,
      $defs: { x: { type: "string" } },
    });
  });

  it("rebases a local ref in every schema-valued keyword position", () => {
    const ref = { $ref: "#/$defs/x" };
    const source = {
      properties: { a: ref },
      patternProperties: { "^x": ref },
      dependentSchemas: { a: ref },
      definitions: { d: ref },
      additionalProperties: ref,
      contains: ref,
      propertyNames: ref,
      items: ref,
      not: ref,
      if: ref,
      then: ref,
      else: ref,
      unevaluatedProperties: ref,
      unevaluatedItems: ref,
      contentSchema: ref,
      allOf: [ref],
      anyOf: [ref],
      oneOf: [ref],
      prefixItems: [ref],
      $defs: { x: { type: "string" }, d: ref },
    };
    expect(hasLocalRefs(source)).toBe(true);
    const found: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          if (key === "$ref" && typeof child === "string") found.push(child);
          else walk(child);
        }
      }
    };
    walk(rebaseRefs(source, "k"));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((refValue) => refValue === "#/components/schemas/k/$defs/x")).toBe(true);
  });

  it("finds and rebases refs under keywords outside the 2020-12 schema list", () => {
    const ref = { $ref: "#/$defs/x" };
    const source = {
      dependencies: { a: ref },
      additionalItems: ref,
      "x-vendor": { template: ref },
      $dynamicRef: "#/$defs/x",
      $defs: { x: { type: "string" } },
    };
    expect(hasLocalRefs(source)).toBe(true);
    expect(rebaseRefs(source, "k")).toEqual({
      dependencies: { a: { $ref: "#/components/schemas/k/$defs/x" } },
      additionalItems: { $ref: "#/components/schemas/k/$defs/x" },
      "x-vendor": { template: { $ref: "#/components/schemas/k/$defs/x" } },
      $dynamicRef: "#/components/schemas/k/$defs/x",
      $defs: { x: { type: "string" } },
    });
    expect(hasLocalRefs({ $dynamicRef: "#/$defs/x", $defs: { x: { type: "string" } } })).toBe(true);
    // instance values stay data even with keys that look like a ref keyword
    expect(hasLocalRefs({ const: { $dynamicRef: "#" } })).toBe(false);
  });

  it("applies the $id boundary to the nested schema's own $ref", () => {
    const source = {
      properties: {
        outer: { $ref: "#/$defs/value" },
        nested: { $id: "https://example.com/n", $ref: "#/$defs/value" },
      },
      $defs: { value: { type: "string" } },
    };
    expect(rebaseRefs(source, "k")).toEqual({
      properties: {
        outer: { $ref: "#/components/schemas/k/$defs/value" },
        nested: { $id: "https://example.com/n", $ref: "#/$defs/value" },
      },
      $defs: { value: { type: "string" } },
    });
  });

  it("resolves a named anchor to the pointer of its $anchor before rebasing", () => {
    const source = {
      properties: {
        item: { $ref: "#item" },
        root: { $ref: "#" },
        known: { $ref: "#/$defs/x" },
        unknown: { $ref: "#missing" },
      },
      $defs: { node: { $anchor: "item", type: "string" }, x: { type: "number" } },
    };
    expect(hasLocalRefs(source)).toBe(true);
    expect(rebaseRefs(source, "k")).toEqual({
      properties: {
        item: { $ref: "#/components/schemas/k/$defs/node" },
        root: { $ref: "#/components/schemas/k" },
        known: { $ref: "#/components/schemas/k/$defs/x" },
        // an anchor that is not in the root resource stays as written: there is no target to point at
        unknown: { $ref: "#missing" },
      },
      $defs: { node: { $anchor: "item", type: "string" }, x: { type: "number" } },
    });
    // an anchor inside a nested $id resource does not resolve from the root's scope
    expect(rebaseRefs({ properties: { a: { $ref: "#item" } }, $defs: { n: { $id: "x", $anchor: "item" } } }, "k")).toEqual({
      properties: { a: { $ref: "#item" } },
      $defs: { n: { $id: "x", $anchor: "item" } },
    });
  });

  it("escapes and URI-encodes JSON Pointer segments in an anchor's target path", () => {
    const cases: Array<[string, string]> = [
      ["a/b~c", "a~1b~0c"],
      ["a b", "a%20b"],
      ["100%", "100%25"],
      ["#x", "%23x"],
      ["caf\u00e9", "caf%C3%A9"],
      ["\ud800", "%EF%BF%BD"],
    ];
    for (const [name, segment] of cases) {
      const source = {
        properties: { a: { $ref: "#item" } },
        $defs: { [name]: { $anchor: "item", type: "string" } },
      };
      const copy = rebaseRefs(source, "k");
      expect(copy.properties).toEqual({ a: { $ref: `#/components/schemas/k/$defs/${segment}` } });
      expect(copy.$defs).toEqual({ [name]: { $anchor: "item", type: "string" } });
    }
  });

  it("recognizes a property that only refers to its parent", () => {
    expect(isParentRef({ $ref: "#" })).toBe(true);
    expect(isParentRef({ $ref: "#/$defs/x" })).toBe(false);
    expect(isParentRef({ $ref: "#", type: "object" })).toBe(false);
  });
});

describe("errorReason", () => {
  it("prints an Error, a string and an unprintable value safely", () => {
    expect(errorReason(new Error("boom"))).toBe("boom");
    expect(errorReason("nope")).toBe("nope");
    expect(errorReason(null)).toBe("null");
    expect(errorReason(undefined)).toBe("undefined");
    expect(errorReason({ toString() { throw new Error("no"); } })).toBe("an error that cannot be printed");
  });
});

describe("oneLine", () => {
  it("collapses whitespace and escapes every control character in the whole message", () => {
    expect(oneLine(new Error("first\nsecond\tthird"))).toBe("first second third");
    expect(oneLine(new Error("bad \u0001 and \u001b[31mred\u001b[0m and \u007f"))).toBe(
      "bad \\u0001 and \\u001b[31mred\\u001b[0m and \\u007f",
    );
    // format controls (bidi overrides/isolates) are escaped too
    expect(oneLine(new Error("\u200eleft\u202eright\u2066isolate"))).toBe(
      "\\u200eleft\\u202eright\\u2066isolate",
    );
    expect(oneLine("  ")).toBe("an unknown error");
  });
});
