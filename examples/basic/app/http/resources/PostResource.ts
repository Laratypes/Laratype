import { defineResource } from "@laratype/http";
import Post from "../../models/Post";

export default defineResource(Post, (post) => ({
  id: post.id,
  content: post.content,
  created_at: post.created_at,
  updated_at: post.updated_at,
}));
