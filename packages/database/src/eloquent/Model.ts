import { Hash } from "@laratype/support";
import { BaseEntity, DeepPartial, SaveOptions, FindOptionsWhere } from "typeorm";

const cast = (input: Record<string, any>) => {
  const result: Record<string, any> = {};
  for (const key in input) {
    result[key] = input[key];
    if (key === 'password') {
      result[key] = Hash.make(input[key]);
    }
  }
  return result;
}

export default class Model extends BaseEntity {
  
  static readonly fillable: string[] = [];

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
        const castedItem = cast(item);
        input.push(castedItem);
      });
      return super.save(input, options);
    }

    const input = cast(data);
    return super.save(input, options);
  }


  /**
   * Finds first entity that matches given conditions.
   */
  static findOneBy<T extends BaseEntity>(this: {
      new (): T;
  } & typeof BaseEntity, where: FindOptionsWhere<T>): any;
  
  static findOneBy(where: any) {
    return super.findOneBy(cast(where));
  }
}