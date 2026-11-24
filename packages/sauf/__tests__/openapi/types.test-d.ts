import { apiRoutes, isApiRoot } from "@laratype/contract";
import type { Api } from "@laratype/contract";
import { describe, expectTypeOf, it } from "vitest";
import { OpenApiGenerationError, generateOpenApiDocument, generateOpenApiFile } from "../../src/openapi";
import type {
  GeneratedOpenApi,
  GeneratedOpenApiFile,
  JsonSchema,
  JsonSchemaIo,
  JsonSchemaResult,
  LoadFunction,
  OpenApiComponents,
  OpenApiContract,
  OpenApiDocument,
  OpenApiFlags,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiProjectOptions,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecurityScheme,
} from "../../src/openapi";

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {};

describe("the OpenAPI document types", () => {
  it("has the shapes the document builder returns", () => {
    expectTypeOf<OpenApiDocument["openapi"]>().toEqualTypeOf<"3.1.0">();
    expectTypeOf<OpenApiDocument["paths"]>().toEqualTypeOf<Record<string, OpenApiPathItem>>();
    expectTypeOf<OpenApiDocument["components"]>().toEqualTypeOf<OpenApiComponents>();
    expectTypeOf<OpenApiOperation["responses"]>().toEqualTypeOf<Record<string, OpenApiResponse>>();
    expectTypeOf<OpenApiOperation["security"]>().toEqualTypeOf<ReadonlyArray<Record<string, readonly string[]>>>();
    expectTypeOf<OpenApiParameter["in"]>().toEqualTypeOf<"path" | "query" | "header">();
    expectTypeOf<OpenApiRequestBody["required"]>().toEqualTypeOf<true>();
    expectTypeOf<OpenApiSecurityScheme["scheme"]>().toEqualTypeOf<"bearer">();
    expectTypeOf<JsonSchema>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<JsonSchemaIo>().toEqualTypeOf<"input" | "output">();
    expectTypeOf<JsonSchemaResult["ok"]>().toEqualTypeOf<boolean>();
  });

  it("types the entry points and the project options", () => {
    expectTypeOf(generateOpenApiDocument).parameters.toEqualTypeOf<[api: unknown, options: OpenApiOptions]>();
    expectTypeOf(generateOpenApiDocument).returns.toEqualTypeOf<GeneratedOpenApi>();
    expectTypeOf(generateOpenApiFile).parameters.toEqualTypeOf<[options: OpenApiProjectOptions]>();
    expectTypeOf(generateOpenApiFile).returns.toEqualTypeOf<Promise<GeneratedOpenApiFile>>();
    expectTypeOf<GeneratedOpenApiFile["file"]>().toEqualTypeOf<string>();
    expectTypeOf<GeneratedOpenApiFile["changed"]>().toEqualTypeOf<boolean>();
    expectTypeOf<OpenApiOptions["contract"]>().toEqualTypeOf<OpenApiContract>();
    expectTypeOf<OpenApiFlags["out"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<OpenApiProjectOptions["contract"]>().toEqualTypeOf<OpenApiContract | undefined>();
    expectTypeOf<LoadFunction>().toEqualTypeOf<(url: string) => Promise<unknown>>();
    expectTypeOf<OpenApiGenerationError>().toMatchTypeOf<Error>();

    typeOnly(() => {
      // the project's own @laratype/contract exports are an OpenApiContract without a cast, and its `Api` brand
      // is what the runtime predicate narrows to
      const runtime: OpenApiContract = { apiRoutes, isApiRoot };
      generateOpenApiDocument({} as Api, { contract: runtime, title: "typed", version: "1.0.0" });
      // @ts-expect-error options.contract is required
      generateOpenApiDocument({}, {});
    });
  });
});
