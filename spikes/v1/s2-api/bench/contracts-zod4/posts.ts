import * as z from "zod/v4";
import { defineContract, endpoint, errors } from "../../../contract";

export const PostDto = z.object({ id: z.number(), userId: z.number(), title: z.string(), body: z.string() });

export const posts = defineContract("posts", {
  index: endpoint.get("/users/:user/posts").query(z.object({ q: z.string().optional() })).response(z.array(PostDto)),
  store: endpoint
    .post("/users/:user/posts")
    .body(z.object({ title: z.string().min(1), body: z.string() }))
    .response(PostDto, 201)
    .errors(errors.validation, errors.forbidden),
});
