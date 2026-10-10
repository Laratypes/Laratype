// docs/v1/di.md: Container + token + deps registry. Proposed in PR #196 (D1) and PR #201 (D2); moves up one level on merge.
import { expectTypeOf } from 'vitest'
import { __laratype_deps, Container, DiError, depsRegistry, token } from '@laratype/core'

// Interfaces have no runtime value: bind them through a typed token.
export interface Mailer { send(to: string, body: string): Promise<void> }
export const MAILER = token<Mailer>('mailer')

export class SmtpMailer implements Mailer {
  async send(_to: string, _body: string) {}
}

export class UserRepository {
  find(id: number) { return { id } }
}

export class UserService {
  // App code is written like this; with `import type { Mailer }` + `@Inject(MAILER)` once D3 (#98) ships.
  constructor(readonly users: UserRepository, readonly mailer: Mailer) {}
}
// What the DI transform (T1 #194, wired by T2 #102) emits after the class. Written by hand here because
// the transform is not part of the example's compile step:
__laratype_deps(UserService, [() => UserRepository, () => MAILER], { params: ['users', 'mailer'] })

// The container reads the emitted metadata through `depsRegistry`.
export const app = new Container({ deps: depsRegistry })
app.singleton(MAILER, () => new SmtpMailer())

const service = app.make(UserService) // UserRepository is autowired (no binding needed)
expectTypeOf(service).toEqualTypeOf<UserService>()
expectTypeOf(app.make(MAILER)).toEqualTypeOf<Mailer>()

// Child containers shadow bindings without touching the parent (tests, per-request overrides).
export const testApp = app.createChild()
testApp.instance(MAILER, { send: async () => {} })

export function missingBinding() {
  try {
    new Container({ deps: depsRegistry }).make(UserService)
  } catch (e) {
    // DiError: No binding for InjectionToken(mailer).
    return e instanceof DiError ? e.message : String(e)
  }
}
