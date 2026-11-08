import { Model } from "@laratype/database";
import { UsePolicy } from "../decorators";
import UnauthorizedException from "../exceptions/UnauthorizedException";
import { Auth } from "../support";
import Policy, { type Ability } from "./Policy";
import PolicyHandler from "./PolicyHandler";

const refuse = (): never => {
  throw new UnauthorizedException();
}

export default class RoutePolicy {

  static make<T extends Ability>(ability: T, modelPolicy: string | typeof Model, ...args: Array<string | typeof Model>) {
    return {
      ability,
      modelPolicy,
      args,
      handle: this.handle
    };
  }

  /** `policy` is the instance the request pipeline resolved from its container (H21 #269), not the class. */
  static async handle<T extends Ability>(ability: T, policy: Policy, ...models: any) {
    const actor = Auth.user();
    if(!actor) {
      refuse();
    }

    const result = await PolicyHandler.can(actor, policy, ability, ...models);
    if(!result) {
      refuse();
    }

    return true;
  }
}
