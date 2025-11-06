import { Model } from "@laratype/database";
import { UsePolicy } from "../decorators";
import UnauthorizedException from "../exceptions/UnauthorizedException";
import { Auth } from "../support";
import Policy, { Ability } from "./Policy";
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

  static async handle<T extends Ability>(ability: T, Po: new () => Policy, ...models: any) {
    const actor = Auth.user();
    if(!actor) {
      return false;
    }
    
    const policy = new Po();
    
    const result = await PolicyHandler.can(actor, policy, ability, ...models);
    if(!result) {
      throw new UnauthorizedException({
        message: 'You are not authorized to perform this action.'
      });
    }

    return true;
  }
}
