import * as z from "zod";
import { describe, expect, it } from "vitest";
import {
  errorReason,
  hasLocalRefs,
  isParentRef,
  isSchemaResource,
  rebaseRefs,
  standardJsonSchema,
  withParentDefs,
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

  it("copies the parent $defs onto a hoisted property, unless it brings its own", () => {
    const root = { $defs: { x: { type: "string" } } };
    expect(withParentDefs(root, { $ref: "#/$defs/x" })).toEqual({
      $ref: "#/$defs/x",
      $defs: { x: { type: "string" } },
    });
    expect(withParentDefs(root, { $ref: "#/$defs/y", $defs: { y: { type: "number" } } })).toEqual({
      $ref: "#/$defs/y",
      $defs: { y: { type: "number" } },
    });
    expect(withParentDefs({}, { type: "string" })).toEqual({ type: "string" });
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
