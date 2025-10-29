import { PromiseAble } from "@laratype/support";

export type Ability = Exclude<keyof Policy, 'before'>;

export default abstract class Policy {
  abstract viewAny(...args: any[]): PromiseAble<boolean | null>;

  abstract view(...args: any[]): PromiseAble<boolean | null>;

  abstract create(...args: any[]): PromiseAble<boolean | null>;

  abstract update(...args: any[]): PromiseAble<boolean | null>;

  abstract delete(...args: any[]): PromiseAble<boolean | null>;

  abstract restore(...args: any[]): PromiseAble<boolean | null>;

  abstract forceDelete(...args: any[]): PromiseAble<boolean | null>;

  public before(actor: any, ability: string): PromiseAble<boolean | null> {
    return null;
  }
  
}
