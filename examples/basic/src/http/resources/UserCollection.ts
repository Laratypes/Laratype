import { ResourceCollection } from "@laratype/http";
import UserResource from "./UserResource";

export default class UserCollection extends ResourceCollection {

  getResource() {
    return UserResource
  }

  public toJson() {
    return {
      data: this.collection
    }
  }
}