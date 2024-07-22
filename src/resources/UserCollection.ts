import Collection from "../../core/resource/json/ResourceCollection";
import UserResource from "./UserResource";

export default class UserCollection extends Collection {

  getResource() {
    return UserResource
  }

  public toJson() {
    return {
      data: this.collection
    }
  }
}