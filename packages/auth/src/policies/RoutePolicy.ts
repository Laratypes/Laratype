import { Model } from "@laratype/database";
import { UsePolicy } from "../decorators";
import UnauthorizedException from "../exceptions/UnauthorizedException";
import { Auth } from "../support";
import Policy, { type Ability } from "./Policy";
import PolicyHandler from "./PolicyHandler";

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
      throw new UnauthorizedException({
        message: 'You are not authorized to perform this action.'
      });
    }

    const result = await PolicyHandler.can(actor, policy, ability, ...models);
    if(!result) {
      throw new UnauthorizedException({
        message: 'You are not authorized to perform this action.'
      });
    }

    return true;
  }
}
