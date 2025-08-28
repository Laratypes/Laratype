import { JsonResource } from "@laratype/http";

export default class PostResource<T extends {}[]> extends JsonResource<T> {
  public toJson() {
    return this.data;
  }
}