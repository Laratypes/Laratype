import { ResourceCollection } from "@laratype/core";
import PostResource from "./PostResource";

export default class PostCollection extends ResourceCollection {

  public resource = PostResource

  public toJson() {
    return {
      data: this.collection
    }
  }
}