import { Controller } from "@laratype/http";
import type { Ctx } from "@laratype/http";
import postsContract from "../../api/posts";
import PostResource from "../resources/PostResource";

export default class PostController extends Controller {

  public store() {
    return {};
  }

  public index(_ctx: Ctx<typeof postsContract.index>) {
    return { data: PostResource.collection([]) };
  }
}
