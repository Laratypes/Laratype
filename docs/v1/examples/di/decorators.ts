// docs/v1/di.md: Decorators: @Inject and @Injectable (D3, merged on master).
import { expectTypeOf } from 'vitest'
import { __laratype_deps, Container, Inject, Injectable, depsRegistry, token } from '@laratype/core'

export interface Mailer { send(to: string, body: string): Promise<void> }
export const MAILER = token<Mailer>('mailer')

export class UserRepository {
  find(id: number) { return { id } }
}

// `@Inject(TOKEN)` on an interface param; `@Injectable({ scope })` only for a non-default lifetime.
@Injectable({ scope: 'singleton' })
export class UserService {
  constructor(readonly users: UserRepository, @Inject(MAILER) readonly mailer: Mailer) {}
}
// What the DI transform emits after the class (written by hand: the transform is not part of this compile step).
__laratype_deps(UserService, [() => UserRepository, () => MAILER], { params: ['users', 'mailer'] })

export const app = new Container({ deps: depsRegistry })
app.instance(MAILER, { send: async () => {} })

const service = app.make(UserService) // autowired once: the root container caches it
expectTypeOf(service).toEqualTypeOf<UserService>()
export const same = app.createChild().make(UserService) === service // true
