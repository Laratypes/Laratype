// Compiled against the generated `.laratype/types/models.d.ts` only (H14 #163): the `Register['models']`
// augmentation must turn `:user` into the User instance, with no r.bind() and no Requires entry.
// Importing the generated appApi is what pulls the models augmentation into a real app's program.
import type {} from '../.laratype/api/index.gen'
import { Controller, Route } from '@laratype/http'
import type { Ctx } from '@laratype/http'
import { defineApi, defineContract, endpoint } from '@laratype/contract'

const users = defineContract()({ show: endpoint.get('/:user') })
const appApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [] } })

class UsersController extends Controller {
  show(ctx: Ctx<typeof users.show>) {
    // `string` here unless the generated augmentation reaches Ctx (a compile error)
    const id: number = ctx.params.user.id
    void id
  }
}

Route.api(appApi, (r) => [r.contract(users, UsersController)])
