import { DeepPartial, FindOptionsRelations } from "typeorm";
import Model from "../eloquent/Model";
import { MetaDataKey } from "@laratype/support";

export type FactoryDefinition<T> = DeepPartial<T>;

type FactoryStateCallback<T> = (attributes: FactoryDefinition<T>) => FactoryDefinition<T>;

class FactoryBuilder<T extends Model> {

  protected factory: Factory;

  protected _count = 1;

  protected _state: FactoryStateCallback<T> | null = null;

  protected hasRelations: Map<string, FactoryBuilder<any>> = new Map();

  constructor(factory: Factory<T>) {
    this.factory = factory;
  }

  count(count: number) {
    if(count <= 0) {
      throw new Error("Count must be greater than 0");
    }
    this._count = count;
    return this;
  }

  has<M extends Model>(factory: FactoryBuilder<M>, relationName: keyof T) {
    this.hasRelations.set(relationName as string, factory);
    return this;
  }

  state(cb: FactoryStateCallback<T>) {
    this._state = cb;
    return this;
  }

  protected build() {
    return Array.from({ length: this._count }, () => {
      const definition = this.factory.definition();
      let dataSave = definition;
      for (const [relationName, relationFactory] of this.hasRelations) {
        dataSave[relationName] = relationFactory.build();
      }
      if(this._state) {
        return {
          ...dataSave,
          ...this._state(dataSave),
        }
      }
      return dataSave;
    });
  }

  async create(): Promise<T[]> {
    const M = Reflect.getMetadata(MetaDataKey.MODEL_FACTORY, this.factory.constructor);
    return Promise.all(this.build().map((definition) => {
      return M.create(definition).save();
    }));
  }
}

export default abstract class Factory<T extends Model = any> {
  abstract definition(): FactoryDefinition<T>;

  protected createDefinition<D extends FactoryDefinition<T>>(definition: D): D {
    return definition;
  }

  static make<M extends Model>(this: {
    new (): Factory;
  }){
    const factory = new this();
    return new FactoryBuilder<M>(factory);
  }
}