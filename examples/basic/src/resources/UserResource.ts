import { JsonResource } from "@laratype/http";

type WrapResource<T> = Array<T> 

export default class UserResource<T extends WrapResource<{}>> extends JsonResource<T> {
  public toJson() {
    return this.data;
  }
}