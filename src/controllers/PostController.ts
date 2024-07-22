import Controller from "../../core/controller/Controller"
import PostCollection from "../resources/PostCollection";
import Posts from "../models/Posts";

export default class PostController extends Controller {

  store() {
    return Posts.create({
      data: {
        content: "Hello World",
        title: "Test Post",
        user_id: 1,
      }
    })
  }

  async index() {
    return new PostCollection(await Posts.findMany())
  }
}