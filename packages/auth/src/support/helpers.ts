import { Model } from "@laratype/database";
import RoutePolicy from "../policies/RoutePolicy";
import { Ability } from "../policies/Policy";

export const can = <T extends Ability>(ability: T, modelPolicy: string | typeof Model, ...args: Array<string | typeof Model>) => {
  return RoutePolicy.make(ability, modelPolicy, ...args);
}
