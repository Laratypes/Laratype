import { InitDatabaseCommand, SeedDatabaseCommand } from "./db";
import LaratypeDevCommand from "./dev";
import { RouteListCommand } from "./route";
import {
  MakeModelCommand,
  MakeCommandCommand,
  MakeControllerCommand,
  MakeMiddlewareCommand,
  MakePolicyCommand,
  MakeGateCommand,
  MakeRequestCommand,
  MakeResourceCommand
} from "./make";

export default [
  LaratypeDevCommand,
  InitDatabaseCommand,
  SeedDatabaseCommand,
  RouteListCommand,
  MakeCommandCommand,
  MakeControllerCommand,
  MakeGateCommand,
  MakeMiddlewareCommand,
  MakeModelCommand,
  MakePolicyCommand,
  MakeRequestCommand,
  MakeResourceCommand,
];
