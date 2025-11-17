import { DatabaseServiceProvider } from "@laratype/database";
import RouteServiceProvider from "../src/providers/RouteServiceProvider";
import RouteBindingsServiceProvider from "../src/providers/RouteBindingServiceProvider";

export default [
  RouteServiceProvider,
  DatabaseServiceProvider,
  RouteBindingsServiceProvider,
]