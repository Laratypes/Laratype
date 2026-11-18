/**
 * `sauf openapi:generate` (G3 #143): OpenAPI 3.1 from the contract tree, no app boot.
 *
 * `generateOpenApiDocument` is the pure document builder (the project's `apiRoutes()`/`isApiRoot()` are passed in, so
 * `sauf` takes no dependency on the contract package); `generateOpenApiFile` is the command's pipeline (scan, import
 * the generated `appApi` and the project's own `@laratype/contract`, write the file).
 */
export { generateOpenApiDocument } from "./document";
export type {
  GeneratedOpenApi,
  OpenApiComponents,
  OpenApiContract,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecurityScheme,
} from "./document";
export { OpenApiGenerationError } from "./errors";
export { generateOpenApiFile } from "./load";
export type { GeneratedOpenApiFile, LoadFunction, OpenApiFlags, OpenApiProjectOptions } from "./load";
export type { JsonSchema, JsonSchemaIo, JsonSchemaResult } from "./schema";
