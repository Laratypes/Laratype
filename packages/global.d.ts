// Define runtime variable type


declare var __PROD__: boolean;

declare var requestGlobalStore: import("async_hooks").AsyncLocalStorage<{
  request: import("@laratype/http").Request;
  user: unknown;
  modelBindings: Record<string, import("typeorm").BaseEntity>
  /** The request scope of the app container (D6 #112), which `RequestKernel` resolves controllers from (H2 #105). */
  container?: import("@laratype/core").Container
}>;

declare var __laratype_env_file: string;

declare var __laratype_config: any;

declare var __sauf_start_time: number;

declare var __sauf_transpiler_instance: any

declare var __APP_PLATFORM__: 'node' | 'deno' | 'edge' | 'bun';

declare var __APP_PROD__: boolean;