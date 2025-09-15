import type { Strategy } from "passport";

export default class PassportStrategy {

  static make(strategy: any): typeof Strategy {
    return strategy;
  }
  
}