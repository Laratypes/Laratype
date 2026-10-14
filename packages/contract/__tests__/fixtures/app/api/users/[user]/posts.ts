// app/api/users/[user]/posts.ts → /api/users/:user/posts, api.users.posts
import * as z from 'zod'
import { defineContract, endpoint, errors } from '@laratype/contract'
import { PostLimit } from '../../errors'
import type { Prefix } from './$types'

export const PostDto = z.object({ id: z.number(), userId: z.number(), title: z.string() })

export default defineContract<Prefix>()({
  index: endpoint.get('/').query(z.object({ q: z.string().optional() })).response(z.array(PostDto)).authorize(false),
  store: endpoint
    .post('/')
    .body(z.object({ title: z.string().min(1) }))
    .response(PostDto, 201)
    .throttle({ limit: 10, per: 60 }),
  search: endpoint.get('/search').public().authorize(false).throws(errors.notFound),
}, { throws: [PostLimit] })
