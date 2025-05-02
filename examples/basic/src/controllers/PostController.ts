import { Controller } from "@laratype/http";
import PostCollection from "../resources/PostCollection";

export default class PostController extends Controller {

  store() {
    return {}
  }

  async index() {
    return new PostCollection({})
  }
}