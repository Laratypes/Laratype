
export default class JsonResource<T = any> {

  public data: T;

  constructor(data: T) {
    if(data instanceof JsonResource) {
      this.data = data.toJson();
    }
    else {
      this.data = data;
    }
  }

  public toJson(): any {
    return this.data
  }

  public toResponse() {
    return this.toJson();
  }

  public static toJson<T>(data: T): unknown {
    if(data instanceof JsonResource) {
      return data.toJson();
    }
    return data;
  }
}