// docs/v1/di.md: Container-backed facades (D8 #115, proposed).
import { expectTypeOf } from 'vitest'
import { Container, Facade, depsRegistry } from '@laratype/core'
import { Hash, Hasher } from '@laratype/support'

// A facade names its accessor and forwards its static methods to `root()`.
export class Clock {
  now() { return Date.now() }
}
export class Time extends Facade {
  static override readonly accessor = Clock
  static now() { return Time.root().now() } // the class, not `this`, so a detached call works
}

// The kernel (`Serve.getContainer()`) sets the app container as the facade application.
const app = new Container({ deps: depsRegistry })
Facade.setFacadeApplication(app)

// 0.5 call sites keep working: the unbound Hasher is autowired.
expectTypeOf(Hash.make('secret')).toEqualTypeOf<string>()

// A provider can bind another implementation. A custom format overrides all four methods together:
// check(), needsRehash() and isHashed() only understand the scrypt format make() writes.
// makeAsync() and checkAsync() default to make() and check(), so the format works as it is.
class Bcrypt extends Hasher {
  override make(value: string) { return `bcrypt:${value}` }
  override check(value: string, hashed: string) { return hashed === this.make(value) }
  override needsRehash(hashed: string) { return !this.isHashed(hashed) }
  override isHashed(value: string) { return value.startsWith('bcrypt:') }
}
app.bind(Hasher, Bcrypt)

// Tests: swap the binding in the app, or fake it through the facade. Both return a restore function.
const restoreHash = app.swap(Hasher, new Bcrypt())
const restoreTime = Time.fake({ now: () => 0 })
restoreTime()
restoreHash()
