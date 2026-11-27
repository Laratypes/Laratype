// docs/v1/di.md: Container + token + deps registry.
import { expectTypeOf } from 'vitest'

// #region tokens
import { __laratype_deps, Container, DiError, depsRegistry, token } from '@laratype/core'

// Interfaces have no runtime value: bind them through a typed token.
export interface Mailer { send(to: string, body: string): Promise<void> }
export const MAILER = token<Mailer>('mailer')

export class SmtpMailer implements Mailer {
  async send(_to: string, _body: string) {}
}
// #endregion tokens

// #region the-dependency-registry
export class UserRepository {
  find(id: number) { return { id } }
}

export class UserService {
  // App code adds `@Inject(MAILER)` to the interface param: see decorators.ts.
  constructor(readonly users: UserRepository, readonly mailer: Mailer) {}
}
// What the DI transform emits after the class. Written by hand here because the transform is not part of the
// example's compile step:
__laratype_deps(UserService, [() => UserRepository, () => MAILER], { params: ['users', 'mailer'] })
// #endregion the-dependency-registry

// #region the-container
// The container reads the emitted metadata through `depsRegistry`.
export const app = new Container({ deps: depsRegistry })
app.singleton(MAILER, () => new SmtpMailer())

const service = app.make(UserService) // UserService: UserRepository is autowired (no binding needed)
const mailer = app.make(MAILER) // Mailer

// Child containers shadow bindings without touching the parent (tests, per-request overrides).
export const testApp = app.createChild()
testApp.instance(MAILER, { send: async () => {} })
// #endregion the-container

// #region errors
export function missingBinding() {
  try {
    new Container({ deps: depsRegistry }).make(UserService)
  } catch (e) {
    // DiError: No binding for InjectionToken(mailer).
    return e instanceof DiError ? e.message : String(e)
  }
}
// #endregion errors

// Type checks, outside the guide regions.
expectTypeOf(service).toEqualTypeOf<UserService>()
expectTypeOf(app.make(MAILER)).toEqualTypeOf<Mailer>()
