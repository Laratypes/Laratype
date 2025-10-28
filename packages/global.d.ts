// Define runtime variable type


declare var __PROD__: boolean;

declare var requestGlobalStore: import("async_hooks").AsyncLocalStorage<{
  request: import("@laratype/http").Request;
  user: unknown;
  modelBindings: Record<string, import("typeorm").BaseEntity>
}>;

declare var __laratype_env_file: string;

declare var __laratype_config: any;

declare var __laratype_db: {
  ds: import("typeorm").DataSource,
  models: Record<string, import("typeorm").BaseEntity>,
};

declare var __laratype_routes: Array<Record<string, any>> | undefined;

declare var __sauf_start_time: number;

declare var __laratype_route_model_bindings: Record<string, any>;

declare var __laratype_param_model_map: Record<string, string>;
