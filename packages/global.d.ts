// Define runtime variable type


declare var __PROD__: boolean;

declare var requestGlobalStore: import("async_hooks").AsyncLocalStorage<{
  request: import("@laratype/http").Request;
  user: unknown;
}>;

declare var __laratype_env_file: string;

declare var __laratype_config: any;

declare var __laratype_db: {
  ds: import("typeorm").DataSource
};