import { Controller } from "@laratype/core"
import PostCollection from "../resources/PostCollection";
import { prisma } from "../../config/database/prisma";

export default class PostController extends Controller {

  store() {
    return prisma.posts.create({
      data: {
        content: "Hello World",
        title: "Test Post",
        user_id: 1,
      }
    })
  }

  async index() {
    return new PostCollection(await prisma.posts.findMany())
  }
}