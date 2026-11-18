import { describe, expectTypeOf, it } from "vitest";
import { OpenApiGenerationError, generateOpenApiDocument, generateOpenApiFile } from "../../src/openapi";
import type {
  GeneratedOpenApi,
  GeneratedOpenApiFile,
  JsonSchema,
  OpenApiComponents,
  OpenApiContract,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiProjectOptions,
  OpenApiResponse,
  OpenApiSecurityScheme,
} from "../../src/openapi";

describe("the OpenAPI document types", () => {
  it("has the shapes the document builder returns", () => {
    expectTypeOf<OpenApiDocument["openapi"]>().toEqualTypeOf<"3.1.0">();
    expectTypeOf<OpenApiDocument["paths"]>().toEqualTypeOf<Record<string, OpenApiPathItem>>();
    expectTypeOf<OpenApiDocument["components"]>().toEqualTypeOf<OpenApiComponents>();
    expectTypeOf<OpenApiOperation["responses"]>().toEqualTypeOf<Record<string, OpenApiResponse>>();
    expectTypeOf<OpenApiOperation["security"]>().toEqualTypeOf<ReadonlyArray<Record<string, readonly string[]>>>();
    expectTypeOf<OpenApiParameter["in"]>().toEqualTypeOf<"path" | "query" | "header">();
    expectTypeOf<OpenApiSecurityScheme["scheme"]>().toEqualTypeOf<"bearer">();
    expectTypeOf<JsonSchema>().toEqualTypeOf<Record<string, unknown>>();
  });

  it("types the entry points", () => {
    expectTypeOf(generateOpenApiDocument).parameters.toEqualTypeOf<[api: object, options?: OpenApiOptions]>();
    expectTypeOf(generateOpenApiDocument).returns.toEqualTypeOf<GeneratedOpenApi>();
    expectTypeOf(generateOpenApiFile).parameters.toEqualTypeOf<[options: OpenApiProjectOptions]>();
    expectTypeOf(generateOpenApiFile).returns.toEqualTypeOf<Promise<GeneratedOpenApiFile>>();
    expectTypeOf<GeneratedOpenApiFile["file"]>().toEqualTypeOf<string>();
    expectTypeOf<GeneratedOpenApiFile["changed"]>().toEqualTypeOf<boolean>();
    expectTypeOf<OpenApiOptions["contract"]>().toEqualTypeOf<OpenApiContract>();
    expectTypeOf<OpenApiProjectOptions["contract"]>().toEqualTypeOf<OpenApiContract | undefined>();
    expectTypeOf<OpenApiGenerationError>().toMatchTypeOf<Error>();

    // @ts-expect-error options.contract is required
    generateOpenApiDocument({}, {});
  });
});
