import { InitDatabaseCommand, SeedDatabaseCommand } from "./db";
import LaratypeDevCommand from "./dev";
import LaratypeBuildCommand from "./build";
import { RouteListCommand } from "./route";
import { TypesGenerateCommand } from "./types";
import { OpenApiGenerateCommand } from "./openapi";
import {
  MakeModelCommand,
  MakeCommandCommand,
  MakeContractCommand,
  MakeControllerCommand,
  MakeMiddlewareCommand,
  MakePolicyCommand,
  MakeGateCommand,
  MakeRequestCommand,
  MakeResourceCommand,
  MakeFactoryCommand,
  MakeSeederCommand,
} from "./make";

export default [
  LaratypeDevCommand,
  LaratypeBuildCommand,
  InitDatabaseCommand,
  SeedDatabaseCommand,
  RouteListCommand,
  TypesGenerateCommand,
  OpenApiGenerateCommand,
  MakeCommandCommand,
  MakeContractCommand,
  MakeControllerCommand,
  MakeFactoryCommand,
  MakeGateCommand,
  MakeMiddlewareCommand,
  MakeModelCommand,
  MakePolicyCommand,
  MakeRequestCommand,
  MakeResourceCommand,
  MakeSeederCommand,
];
