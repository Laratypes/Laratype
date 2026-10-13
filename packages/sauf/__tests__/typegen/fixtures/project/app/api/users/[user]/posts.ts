// app/api/users/[user]/posts.ts → /api/users/:user/posts, api.users.posts
import * as z from 'zod'
import { defineContract, endpoint } from '@laratype/contract'
import type { Prefix } from './$types'

const PostDto = z.object({ id: z.number(), title: z.string() })

export default defineContract<Prefix>()({
  index: endpoint.get('/').response(z.array(PostDto)).authorize(false),
  update: endpoint.patch('/:post').body(PostDto.pick({ title: true })).response(PostDto),
})
