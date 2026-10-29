import { Hash } from "@laratype/support";
import { BaseEntity, type DeepPartial, type SaveOptions, type FindOptionsWhere } from "typeorm";

const cast = (input: Record<string, any>, passwordField: string) => {
  const result: Record<string, any> = {};
  for (const key in input) {
    result[key] = input[key];
    // A value that is already a hash is stored as it is, not hashed again
    if (key === passwordField && !Hash.isHashed(input[key])) {
      result[key] = Hash.make(input[key]);
    }
  }
  return result;
}

const fillableGuard = (input: Record<string, any>, fillable: string[]) => {
  const result: Record<string, any> = {};
  for (const key in input) {
    if(fillable.includes(key)) {
      result[key] = input[key];
    }
  }
  return result;
}

export default class Model extends BaseEntity {
  
  static readonly fillable: string[] = [];

  /**
   * The credential column: `save()`, `update()` and `updateFor()` hash a plain value in it, and `findOneBy()` refuses
   * it. A model that stores the password in another column overrides it, and the guard's `passwordField` names the same.
   */
  static readonly passwordField: string = 'password';

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  static save<T extends BaseEntity>(this: {
      new (): T;
  } & typeof BaseEntity, entities: DeepPartial<T>[], options?: SaveOptions): Promise<T[]>;
  /**
   * Saves a given entity in the database.
   * If entity does not exist in the database then inserts, otherwise updates.
   */
  static save<T extends BaseEntity>(this: {
      new (): T;
  } & typeof BaseEntity, entity: DeepPartial<T>, options?: SaveOptions): Promise<T>;

  static save(data: any, options?: SaveOptions) {
    if(Array.isArray(data)) {
      const input: Record<string, any>[] = [];
      data.forEach(item => {
        const castedItem = cast(fillableGuard(item, this.fillable), this.passwordField);
        input.push(castedItem);
      });
      return super.save(input, options);
    }

    const input = cast(fillableGuard(data, this.fillable), this.passwordField);
    return super.save(input, options);
  }

  static update(criteria: any, data: any) {
    const input = cast(fillableGuard(data, this.fillable), this.passwordField);
    
    return super.update(criteria, input);
  }

  /**
   * Updates the given model with provided data.
   */
  static updateFor<T extends BaseEntity>(this: {
      new (): T;
  } & typeof BaseEntity, model: T, data: DeepPartial<T>): Promise<T>;

  static updateFor(model: any, data: any) {
    const input = cast(fillableGuard(data, this.fillable), this.passwordField);
    for (const field in input) {
      if(Object.prototype.hasOwnProperty.call(model, field)) {
        model[field] = input[field];
      }
    }

    return model.save().then(() => model);
  }

  /**
   * Finds first entity that matches given conditions.
   */
  static findOneBy<T extends BaseEntity>(this: {
      new (): T;
  } & typeof BaseEntity, where: FindOptionsWhere<T>): any;
  
  // Not cast: a salted password hash never matches in a where clause; check it with Hash.check() after the lookup
  static findOneBy(where: any) {
    // A 0.5 caller's { email, password } would put a plain password in the SQL parameters and never match a hash
    if (where && typeof where === 'object' && Object.prototype.hasOwnProperty.call(where, this.passwordField)) {
      throw new Error(
        "[@laratype/database] findOneBy() cannot look a user up by password: look the user up without it, then check the password with Hash.check()",
      );
    }
    return super.findOneBy(where);
  }
}
