// docs/v1/auth.md: guards in the container (A4 #151, proposed).
import { AUTH_CONFIG, AuthManager, Auth } from '@laratype/auth'
import { Middleware, type MiddlewareHandler } from '@laratype/http'
import { ContextApi, ServiceProvider } from '@laratype/support'

declare class User { id: number; email: string }

// PassportServiceProvider.register() binds AUTH_CONFIG and the AuthManager singleton from app/config/auth.ts.
export class AuditServiceProvider extends ServiceProvider {
  boot() {
    const config = this.app.make(AUTH_CONFIG)
    const auth = this.app.make(AuthManager)
    // guard(name?) builds the guard once per name; the default guard is config.default.guard.
    console.log(auth.defaultGuard === config.default.guard, auth.guard('admin').name)
  }
}

// A middleware that authenticates with a named guard, like AuthGuard does with the default one.
export class AdminGuard extends Middleware {
  handle: MiddlewareHandler = async (request, res, next) => {
    const container = ContextApi.getContainer()
    if (!container) throw new Error('No app container: serve the route through RequestKernel')
    const user = await container.make(AuthManager).guard<User>('admin').user(request)
    if (!user) throw new Error('Unauthenticated')
    ContextApi.setUser(user)
    return next(request)
  }
}

// The 0.5 API is unchanged and resolves the same guards: Auth.guard('web').attempt(), Auth.user().generateToken().
export async function login(fields: { email: string, password: string }) {
  const attempt = await Auth.guard<any>('web').attempt(fields)
  return attempt ? attempt.generateToken({ name: 'Default Token', abilities: '*' }) : null
}
