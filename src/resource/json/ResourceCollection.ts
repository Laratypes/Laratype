import CollectionInterface from "../../contracts/CollectionInterface";
import JsonResource from "./JsonResource";

export default class ResourceCollection<T extends unknown = {}> extends JsonResource implements CollectionInterface {
  
  public collection: ReturnType<ReturnType<this['getResource']>['prototype']['toJson']>;

  constructor(data: T) {
    super(data);
    const resource = this.getResource()
    const resourceInstance = new resource(data)
    this.collection = resourceInstance.toJson()
    
  }

  public getResource(): typeof JsonResource<T> {
    return JsonResource;
  }

  public toJson(): any {
    return this.collection
  }
}