// docs/v1/auth.md › Typed Register (A1 #119, proposed).
import { Auth } from '@laratype/auth'
import { Model } from '@laratype/database'

class User extends Model {
  id!: number
  email!: string
}

// The app registers its user and guard names once, by module augmentation (app/declare/auth.d.ts in examples/basic).
declare module '@laratype/auth' {
  interface Register {
    user: User
    guards: {
      web: true
      api: true
      admin: true
    }
  }
}

export async function me() {
  const authenticated = Auth.user() // Authenticated<User> | null, no type argument
  if (!authenticated) return null
  return authenticated.getUser() // User
}

export function login(fields: { email: string, password: string }) {
  // 'web' is a registered guard; Auth.guard('nope') is a type error
  return Auth.guard('web').attempt(fields) // Promise<false | Authenticated<User>>
}
