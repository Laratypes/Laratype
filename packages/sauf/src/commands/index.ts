import { InitDatabaseCommand, SeedDatabaseCommand } from "./db";
import LaratypeDevCommand from "./dev";
import LaratypeBuildCommand from "./build";
import { RouteListCommand } from "./route";
import {
  MakeModelCommand,
  MakeCommandCommand,
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
  MakeCommandCommand,
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
