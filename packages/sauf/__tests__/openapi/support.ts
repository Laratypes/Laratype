import { apiRoutes, isApiRoot } from "@laratype/contract";
import { generateOpenApiDocument } from "../../src/openapi";
import type { GeneratedOpenApi, OpenApiContract, OpenApiOptions } from "../../src/openapi";

/** The project's contract runtime, as `load.ts` takes it from the app (tests use the workspace copy). */
export const contractRuntime: OpenApiContract = { apiRoutes, isApiRoot };

/** `generateOpenApiDocument` with the fixed test metadata. */
export const openApi = (api: object, options: Omit<OpenApiOptions, "contract"> = {}): GeneratedOpenApi =>
  generateOpenApiDocument(api, { contract: contractRuntime, title: "test-api", version: "9.9.9", ...options });

/** Every `$ref` string in a document, in walk order. */
export function refs(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) refs(item, found);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") found.push(child);
      else refs(child, found);
    }
  }
  return found;
}
