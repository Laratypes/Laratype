import ResourceCollection from "../../core/resource/json/ResourceCollection";
import PostResource from "./PostResource";

export default class PostCollection extends ResourceCollection {

  public resource = PostResource

  public toJson() {
    return {
      data: this.collection
    }
  }
}