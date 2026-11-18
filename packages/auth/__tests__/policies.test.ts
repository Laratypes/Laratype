// A3 #121: typed policies and gates (docs/v1/auth.md › Policies and gates)
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Container, Facade, __laratype_deps, depsRegistry } from '@laratype/core'
import { errors } from '@laratype/contract'
import { Model } from '@laratype/database'
import { ContextApi, InternalException } from '@laratype/support'
import { ForbiddenException, Gate, GateManager, policyAllows, policyAuthorize, policyCheck } from '../src'
import { Authenticated } from '../src/verifications/AuthVerification'
import type { GateAbility, HasPolicy } from '../src'

class User extends Model {
  id!: number
}

class PostModel extends Model {
  id!: number
  userId!: number
}

/** The one policy type `post` declares, so `Authenticated.can()` type-checks; the ability types are in policies.test-d.ts. */
class PostPolicy {
  viewAny(_user: User): boolean {
    return true
  }
  update(_user: User, _post: PostModel): boolean {
    return true
  }
}

/** The type half of Gate.policy(PostModel, PostPolicy), as an intersection: the brand adds nothing at runtime. */
type Post = PostModel & HasPolicy<PostPolicy>

class Comment extends Model {
  id!: number
}

/** A subclass is a model of its own: it has no policy unless its own class is registered. */
class AdminPost extends PostModel {}

const user = Object.assign(new User(), { id: 1 })
const post = Object.assign(new PostModel(), { id: 7, userId: 1 }) as Post

let app: Container

beforeEach(() => {
  app = new Container({ deps: depsRegistry })
  Facade.setFacadeApplication(app)
})

afterEach(() => Facade.setFacadeApplication(undefined))

/**
 * `Gate.allows()` for a runtime ability name: the tests below check behaviour with policies built on the fly, and
 * `policies.test-d.ts` checks the ability and argument types.
 */
const allows = (user: unknown, ability: string, subject: unknown, ...args: unknown[]): Promise<boolean> =>
  Gate.allows(user, ability as never, subject as never, ...args)

/** `Gate.denies()`, for a runtime ability name (see `allows`). */
const denies = (user: unknown, ability: string, subject: unknown, ...args: unknown[]): Promise<boolean> =>
  Gate.denies(user, ability as never, subject as never, ...args)

/** `Gate.authorize()`, for a runtime ability name (see `allows`). */
const authorize = (user: unknown, ability: string, subject: unknown, ...args: unknown[]): Promise<void> =>
  Gate.authorize(user, ability as never, subject as never, ...args)

/** `Authenticated.can()`, for a runtime ability name (see `allows`). */
const can = (
  authenticated: Authenticated<User>,
  ability: string,
  subject: unknown,
  ...args: unknown[]
): Promise<boolean> =>
  (authenticated.can as unknown as (ability: string, subject: unknown, ...args: unknown[]) => Promise<boolean>)(
    ability,
    subject,
    ...args,
  )

/** The policy instance and its calls, for a policy whose decision the test sets. */
const policyWith = (decide: (user: unknown, post: Post, ...args: unknown[]) => unknown) => {
  const calls: unknown[][] = []
  class Policy {
    update(...args: unknown[]) {
      calls.push(args)
      return decide(...(args as [unknown, Post]))
    }
  }
  return { Policy, calls }
}

describe('Gate.allows: policies', () => {
  it('runs the ability with the user and the subject, and allows only an explicit true', async () => {
    const { Policy, calls } = policyWith(() => true)
    Gate.policy(PostModel, Policy)
    expect(await allows(user, 'update', post)).toBe(true)
    expect(calls).toEqual([[user, post]])
    // The ability's own extra arguments follow the subject
    const withArgs: unknown[][] = []
    class SharingPolicy {
      share(...args: unknown[]) {
        withArgs.push(args)
        return true
      }
    }
    Gate.policy(Comment, SharingPolicy)
    const comment = new Comment()
    expect(await allows(user, 'share', comment, post, 3)).toBe(true)
    expect(withArgs).toEqual([[user, comment, post, 3]])
  })

  it('denies a non-true answer: a truthy value, a number and undefined are not an allow', async () => {
    const answers = ['yes', 1, {}, undefined]
    for (const answer of answers) {
      class Subject extends Model {}
      class Policy {
        update() {
          return answer
        }
      }
      Gate.policy(Subject, Policy)
      expect(await allows(user, 'update', new Subject())).toBe(false)
    }
  })

  it('awaits an async ability and an async before', async () => {
    class AsyncPolicy {
      async update(_user: User, _post: Post) {
        return true
      }
    }
    Gate.policy(PostModel, AsyncPolicy)
    expect(await allows(user, 'update', post)).toBe(true)

    class AsyncBefore {
      async before() {
        return false
      }
      update() {
        return true
      }
    }
    Gate.policy(Comment, AsyncBefore)
    expect(await allows(user, 'update', new Comment())).toBe(false)
  })

  it('lets before allow, deny or fall through, receiving the user, the ability and the subject', async () => {
    const answers: unknown[] = [true, false, null]
    const seen: unknown[][] = []
    class BeforePolicy {
      before(...args: unknown[]) {
        seen.push(args)
        return answers.shift() ?? null
      }
      update() {
        return true
      }
    }
    Gate.policy(PostModel, BeforePolicy)
    expect(await allows(user, 'update', post)).toBe(true)
    expect(await allows(user, 'update', post)).toBe(false)
    expect(await allows(user, 'update', post)).toBe(true)
    expect(seen[0]).toEqual([user, 'update', post])
  })

  it('treats a non-boolean before as no opinion, as 0.5 does', async () => {
    class TruthyBefore {
      // 0.5's before() is typed boolean | null, but a JS caller can return anything
      before() {
        return 'yes' as unknown as boolean
      }
      update() {
        return false
      }
    }
    Gate.policy(PostModel, TruthyBefore)
    expect(await allows(user, 'update', post)).toBe(false)
  })

  it('throws when the subject has no policy, never denying silently', async () => {
    const message = '[@laratype/auth] Gate.allows: no policy is defined for Comment.'
      + ' Fix: register it with Gate.policy(Comment, <Policy>) in a service provider.'
    await expect(allows(user, 'update', new Comment())).rejects.toThrow(message)
    await expect(authorize(user, 'update', new Comment())).rejects.toThrow(
      message.replace('Gate.allows', 'Gate.authorize'),
    )
  })

  it('looks the policy up by the exact class: a subclass needs its own registration', async () => {
    const { Policy } = policyWith(() => true)
    Gate.policy(PostModel, Policy)
    expect(await allows(user, 'update', post)).toBe(true)
    await expect(allows(user, 'update', new AdminPost())).rejects.toThrow(
      'no policy is defined for AdminPost',
    )
  })

  it('takes a model class as the subject, for an ability with no model yet', async () => {
    const calls: unknown[][] = []
    class CreatePolicy {
      create(...args: unknown[]) {
        calls.push(args)
        return true
      }
    }
    Gate.policy(PostModel, CreatePolicy)
    expect(await allows(user, 'create', PostModel)).toBe(true)
    // The class is the subject: the policy receives it as its subject argument
    expect(calls).toEqual([[user, PostModel]])
  })

  it('denies an ability the policy does not have, and authorize answers the 403', async () => {
    const { Policy } = policyWith(() => true)
    Gate.policy(PostModel, Policy)
    expect(await allows(user, 'delete', post)).toBe(false)
    expect(await denies(user, 'delete', post)).toBe(true)
    await expect(authorize(user, 'delete', post)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('builds the policy with constructor injection from the container', async () => {
    class Permissions {
      allows() {
        return false
      }
    }
    class AllowAll extends Permissions {
      override allows() {
        return true
      }
    }
    class DenyAll extends Permissions {
      override allows() {
        return false
      }
    }
    class InjectedPolicy {
      constructor(private readonly permissions: Permissions) {}
      update() {
        return this.permissions.allows()
      }
    }
    // What the `laratype:di` transform records for a class with an own constructor (docs/v1/di.md)
    __laratype_deps(InjectedPolicy, [() => Permissions], { params: ['permissions'] })
    app.bind(Permissions, DenyAll)
    Gate.policy(PostModel, InjectedPolicy)
    expect(await allows(user, 'update', post)).toBe(false)

    // The request scope's own binding reaches the policy, not the app container's
    const scope = app.createRequestScope()
    scope.instance(Permissions, new AllowAll())
    await ContextApi.run({ container: scope } as never, async () => {
      expect(await allows(user, 'update', post)).toBe(true)
    })
    await scope.dispose()
  })

  it('does not call the policy for a guest, and authorize answers the 403', async () => {
    const { Policy, calls } = policyWith(() => true)
    Gate.policy(PostModel, Policy)
    expect(await allows(undefined, 'update', post)).toBe(false)
    expect(await allows(null, 'update', post)).toBe(false)
    expect(await denies(undefined, 'update', post)).toBe(true)
    await expect(authorize(undefined, 'update', post)).rejects.toBeInstanceOf(ForbiddenException)
    expect(calls).toEqual([])
  })
})

describe('Gate.policy: registration', () => {
  it('registers a policy once: the same class is a no-op, another one throws', async () => {
    class FirstPolicy {}
    class SecondPolicy {}
    Gate.policy(PostModel, FirstPolicy)
    expect(() => Gate.policy(PostModel, FirstPolicy)).not.toThrow()
    expect(() => Gate.policy(PostModel, SecondPolicy)).toThrow(
      '[@laratype/auth] PostModel already has the policy FirstPolicy; a model has one policy (register it once).',
    )
  })

  it('refuses a value that is not a class', () => {
    class A {}
    expect(() => Gate.policy(PostModel, new A() as never)).toThrow(
      '[@laratype/auth] Gate.policy: the policy must be a class, got object.',
    )
    expect(() => Gate.policy(post as never, A)).toThrow(
      '[@laratype/auth] Gate.policy: the model must be a class, got object.',
    )
    expect(() => Gate.policy(undefined as never, A)).toThrow(
      '[@laratype/auth] Gate.policy: the model must be a class, got undefined.',
    )
  })

  it('keeps a registry per container, bound on first use', () => {
    expect(GateManager.current()).toBe(GateManager.current())
    const other = new Container()
    expect(other.make(GateManager)).not.toBe(GateManager.current())
  })
})

describe('Gate.authorize: the 403', () => {
  it('throws the error whose wire body is the contract\'s derived forbidden', async () => {
    class DenyPolicy {
      delete() {
        return false
      }
    }
    Gate.policy(PostModel, DenyPolicy)
    const error = await authorize(user, 'delete', post).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ForbiddenException)
    const forbidden = error as ForbiddenException
    expect(forbidden.getHttpCode()).toBe(403)
    expect(forbidden.getErrorCode()).toBe('FORBIDDEN')
    expect(forbidden.canResponsible()).toBe(true)
    // http.md › Exceptions sends a responsible 4xx Exception as its toJson(): the derived 403's { code, ...body }
    const derived = errors.forbidden()
    expect(forbidden.toJson()).toEqual({ code: derived.code, ...derived.body })
    expect(forbidden.getHttpCode()).toBe(derived.status)
  })
})

describe('gates: Gate.define', () => {
  it('builds a typed gate checked with Gate.allows, denies and authorize', async () => {
    const target = Object.assign(new User(), { id: 1 })
    const other = Object.assign(new User(), { id: 2 })
    const UpdateUser = Gate.define('update-user', (actor: User, user: User) => actor.id === user.id)
    expect(UpdateUser.name).toBe('update-user')
    expect(await Gate.allows(user, UpdateUser, target)).toBe(true)
    expect(await Gate.allows(user, UpdateUser, other)).toBe(false)
    expect(await Gate.denies(user, UpdateUser, other)).toBe(true)
    await expect(Gate.authorize(user, UpdateUser, other)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('allows only an explicit true, and propagates what the gate throws', async () => {
    const Truthy = Gate.define('truthy', (() => 'yes') as never)
    expect(await Gate.allows(user, Truthy)).toBe(false)
    const Boom = Gate.define('boom', () => {
      throw new Error('boom')
    })
    await expect(Gate.allows(user, Boom)).rejects.toThrow('boom')
  })

  it('does not ask a gate about a guest', async () => {
    let called = 0
    const Guest = Gate.define('guest', () => {
      called++
      return true
    })
    expect(await Gate.allows(undefined, Guest)).toBe(false)
    expect(await Gate.denies(undefined, Guest)).toBe(true)
    await expect(Gate.authorize(undefined, Guest)).rejects.toBeInstanceOf(ForbiddenException)
    expect(called).toBe(0)
  })

  it('refuses a bad name or function', () => {
    expect(() => Gate.define('', () => true)).toThrow(
      '[@laratype/auth] Gate.define: the name must be a non-empty string, got string.',
    )
    expect(() => Gate.define(3 as never, () => true)).toThrow(
      '[@laratype/auth] Gate.define: the name must be a non-empty string, got number.',
    )
    expect(() => Gate.define('x', 'nope' as never)).toThrow(
      '[@laratype/auth] Gate.define: the gate must be a function, got string.',
    )
  })
})

/**
 * #394: `asGate()` accepts any object with a callable `check`, so the exact-`true` rule is applied on the three
 * `Gate` call sites, not only inside the `check` that `Gate.define()` builds. A thrown or rejected check is not a
 * denial: it propagates, as docs/v1/auth.md › Invariants says.
 */
describe('hand-built gates: exact true (#394)', () => {
  /** A gate that is not from Gate.define(): asGate() only requires a non-null object with a callable check. */
  const gate = (check: (user: unknown, ...args: unknown[]) => unknown): GateAbility<readonly unknown[]> =>
    ({ name: 'hand-built', check } as unknown as GateAbility<readonly unknown[]>)

  /** A gate whose check answers with `answer`. */
  const handBuilt = (answer: unknown) => gate(() => answer)

  /** The value of an `expect()` message: the answers include symbols, symbol wrappers and huge strings. */
  const answerLabel = (answer: unknown): string => {
    try {
      return String(answer).slice(0, 40)
    } catch {
      return Object.prototype.toString.call(answer)
    }
  }

  it('denies every answer that is not exactly true, through allows, denies and authorize', async () => {
    const answers = [
      1, 0, -0, NaN, Infinity, -Infinity, 'true', '', 'yes', {}, [], [true],
      { valueOf: () => true }, { toString: () => 'true' }, Object(true), Object(Symbol('true')),
      Symbol('true'), false, null, undefined, () => true, { length: 1e9 },
      // A null prototype and an own "__proto__" key: neither is true
      Object.create(null), JSON.parse('{"__proto__": true}'),
      // Unicode and control characters: none coerces to true
      '\uD800', '\u0000', 'true'.repeat(100_000),
    ]
    for (const answer of answers) {
      expect(await Gate.allows(user, handBuilt(answer)), answerLabel(answer)).toBe(false)
      expect(await Gate.denies(user, handBuilt(answer)), answerLabel(answer)).toBe(true)
      await expect(Gate.authorize(user, handBuilt(answer)), answerLabel(answer)).rejects.toBeInstanceOf(ForbiddenException)
    }
  })

  it('allows exactly true', async () => {
    expect(await Gate.allows(user, handBuilt(true))).toBe(true)
    expect(await Gate.denies(user, handBuilt(true))).toBe(false)
    await expect(Gate.authorize(user, handBuilt(true))).resolves.toBeUndefined()
  })

  it('awaits a promise or a thenable and still allows only true', async () => {
    expect(await Gate.allows(user, handBuilt(Promise.resolve(1)))).toBe(false)
    expect(await Gate.allows(user, handBuilt(Promise.resolve(true)))).toBe(true)
    const thenable = (value: unknown) => ({ then(resolve: (settled: unknown) => void) { resolve(value) } })
    expect(await Gate.allows(user, handBuilt(thenable(1)))).toBe(false)
    expect(await Gate.denies(user, handBuilt(thenable(1)))).toBe(true)
    expect(await Gate.allows(user, handBuilt(thenable(true)))).toBe(true)
  })

  it('reads check from a prototype, a non-enumerable own property or an accessor, and still allows only true', async () => {
    // A class instance: check is inherited from the prototype
    class PrototypeGate {
      check() {
        return 1
      }
    }
    expect(await Gate.allows(user, new PrototypeGate() as unknown as GateAbility<readonly unknown[]>)).toBe(false)
    class AllowingPrototypeGate {
      check() {
        return true
      }
    }
    expect(await Gate.allows(user, new AllowingPrototypeGate() as unknown as GateAbility<readonly unknown[]>)).toBe(true)

    // A non-enumerable own check is still a callable
    const hidden = Object.defineProperty({}, 'check', { value: () => 1, enumerable: false })
    expect(await Gate.allows(user, hidden as never)).toBe(false)

    // An accessor that returns a function is read by asGate; its answer is not true
    expect(await Gate.allows(user, { get check() { return () => 1 } } as never)).toBe(false)
    expect(await Gate.allows(user, { get check() { return () => true } } as never)).toBe(true)
  })

  it('propagates a thrown or rejected check instead of turning it into a denial', async () => {
    const thrown = gate(() => {
      throw new Error('the check threw')
    })
    await expect(Gate.allows(user, thrown)).rejects.toThrow('the check threw')
    await expect(Gate.denies(user, thrown)).rejects.toThrow('the check threw')
    await expect(Gate.authorize(user, thrown)).rejects.toThrow('the check threw')

    const rejected = gate(() => Promise.reject(new Error('the check rejected')))
    await expect(Gate.allows(user, rejected)).rejects.toThrow('the check rejected')
    await expect(Gate.denies(user, rejected)).rejects.toThrow('the check rejected')
    await expect(Gate.authorize(user, rejected)).rejects.toThrow('the check rejected')

    // A thenable whose `then` accessor throws rejects the await, rather than answering false
    const badThen = gate(() => ({
      get then(): never {
        throw new Error('the then accessor threw')
      },
    }))
    await expect(Gate.allows(user, badThen)).rejects.toThrow('the then accessor threw')
  })
})

describe('Gate.allows: a value that is neither an ability nor a gate', () => {
  it('throws instead of denying', async () => {
    await expect(Gate.allows(user, 42 as never, post)).rejects.toThrow(
      '[@laratype/auth] Gate.allows: the ability must be an ability name or a gate from Gate.define(), got number.',
    )
    await expect(Gate.denies(user, {} as never, post)).rejects.toThrow(
      '[@laratype/auth] Gate.denies: the ability must be an ability name or a gate from Gate.define(), got object.',
    )
    await expect(Gate.authorize(user, null as never, post)).rejects.toThrow(
      '[@laratype/auth] Gate.authorize: the ability must be an ability name or a gate from Gate.define(), got null.',
    )
  })
})

describe('policyCheck, policyAllows and policyAuthorize', () => {
  class SomePolicy {
    before() {
      return null
    }
    update() {
      return true
    }
  }

  it('is tri-state: before, then the method, null when neither answered', async () => {
    expect(await policyCheck(new SomePolicy(), user, 'update', post)).toBe(true)
    expect(await policyCheck(new SomePolicy(), user, 'missing', post)).toBeNull()
    expect(new ForbiddenException()).toBeInstanceOf(Error)
  })

  it('never treats before as an ability, nor constructor', async () => {
    let before = 0
    class Counting {
      before() {
        before++
        return null
      }
    }
    expect(await policyCheck(new Counting(), user, 'before', post)).toBeNull()
    expect(before).toBe(1)
    expect(await policyCheck(new Counting(), user, 'constructor', post)).toBeNull()
  })

  it('allows only true and throws the 403 otherwise', async () => {
    class Deny {
      update() {
        return false
      }
    }
    expect(await policyAllows(new Deny(), user, 'update', post)).toBe(false)
    await expect(policyAuthorize(new Deny(), user, 'update', post)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('treats a policy exception as an error, not a deny', async () => {
    class Broken {
      update() {
        throw new Error('boom')
      }
    }
    await expect(policyAllows(new Broken(), user, 'update', post)).rejects.toThrow('boom')
  })

  it('denies a guest without calling the policy, even when before() would allow', async () => {
    let called = 0
    class AllowEveryone {
      before() {
        called++
        return true
      }
    }
    expect(await policyCheck(new AllowEveryone(), undefined, 'update', post)).toBe(false)
    expect(await policyAllows(new AllowEveryone(), null, 'update', post)).toBe(false)
    await expect(policyAuthorize(new AllowEveryone(), undefined, 'update', post)).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(called).toBe(0)
  })
})

describe('Authenticated.can', () => {
  it('runs the subject policy with the signed-in user and reads the subject policy, as Laravel does', async () => {
    const calls: unknown[][] = []
    class Policy {
      update(...args: unknown[]) {
        calls.push(args)
        return true
      }
    }
    Gate.policy(PostModel, Policy)
    const authenticated = new Authenticated<User>(user, undefined as never)
    expect(await authenticated.can('update', post)).toBe(true)
    expect(await authenticated.cannot('update', post)).toBe(false)
    expect(calls).toEqual([[user, post], [user, post]])
  })
})

describe('InternalException for a missing policy', () => {
  it('is a 500, not a 403: a configuration bug fails closed', async () => {
    const error = await allows(user, 'update', new Comment()).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(InternalException)
    expect((error as InternalException).getHttpCode()).toBe(500)
  })

  it('rejects instead of throwing before a promise (#394)', async () => {
    // A caller that uses `.catch()` / `.then()` sees the error; `can()` returns the promise rather than throwing
    let pending: Promise<boolean> | undefined
    expect(() => {
      pending = GateManager.current().allows(user, 'update', new Comment())
    }).not.toThrow()
    await expect(pending).rejects.toBeInstanceOf(InternalException)

    await expect(GateManager.current().denies(user, 'update', new Comment()))
      .rejects.toBeInstanceOf(InternalException)
    await expect(GateManager.current().authorize(user, 'update', new Comment()))
      .rejects.toBeInstanceOf(InternalException)

    const authenticated = new Authenticated<User>(user, undefined as never)
    let pendingCan: Promise<boolean> | undefined
    expect(() => {
      pendingCan = can(authenticated, 'update', new Comment())
    }).not.toThrow()
    await expect(pendingCan).rejects.toBeInstanceOf(InternalException)
  })
})

/**
 * #394: the Object.prototype methods are not abilities. The `hasOwnProperty`/`propertyIsEnumerable` probe used to
 * allow: the user is coerced to a property name, and a policy field (`repo`) is an own property of the instance.
 */
describe('Object.prototype methods are not abilities (#394)', () => {
  class Repo {
    find() {
      return true
    }
  }

  /** A policy with a constructor-injected field, the own property the probe used to hit. */
  class FieldPolicy {
    constructor(public repo: Repo) {}
    update() {
      return true
    }
  }
  __laratype_deps(FieldPolicy, [() => Repo], { params: ['repo'] })

  /** A user whose String() is the policy field's name: the probe's key. */
  const probingUser = () => Object.assign(new User(), { toString: () => 'repo' })

  /** Every own name of Object.prototype: constructor, the legacy __define* / __lookup* accessors, toString, ... */
  const objectPrototypeNames = Object.getOwnPropertyNames(Object.prototype)

  const register = () => Gate.policy(PostModel, FieldPolicy)

  it('denies every Object.prototype name through Gate.allows and policyCheck', async () => {
    register()
    const policy = new FieldPolicy(new Repo())
    for (const name of objectPrototypeNames) {
      expect(await allows(probingUser(), name, post), name).toBe(false)
      expect(await policyCheck(policy, probingUser(), name, post), name).not.toBe(true)
    }
  })

  it('authorizes none of them, and answers the 403 instead of a TypeError', async () => {
    register()
    for (const name of objectPrototypeNames) {
      await expect(authorize(probingUser(), name, post), name).rejects.toBeInstanceOf(ForbiddenException)
    }
  })

  it('denies every Object.prototype name through Authenticated.can too', async () => {
    register()
    const authenticated = new Authenticated<User>(probingUser(), undefined as never)
    for (const name of objectPrototypeNames) {
      expect(await can(authenticated, name, post), name).toBe(false)
    }
  })

  it('still runs a method inherited from a policy base class', async () => {
    class BasePolicy {
      update() {
        return true
      }
    }
    class ChildPolicy extends BasePolicy {}
    Gate.policy(PostModel, ChildPolicy)
    expect(await allows(user, 'update', post)).toBe(true)
    expect(await policyCheck(new ChildPolicy(), user, 'update', post)).toBe(true)
  })
})

describe('an accessor is never an ability (#394)', () => {
  it('denies a getter that returns a function, through Gate.allows, policyCheck and authorize', async () => {
    class GetterPolicy {
      get create() {
        return () => true
      }
    }
    Gate.policy(PostModel, GetterPolicy)
    expect(await allows(user, 'create', post)).toBe(false)
    expect(await policyCheck(new GetterPolicy(), user, 'create', post)).not.toBe(true)
    await expect(authorize(user, 'create', post)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('denies a getter that throws, instead of a 500, and never runs it during the lookup', async () => {
    let reads = 0
    class ThrowingGetter {
      get create(): () => boolean {
        reads++
        throw new Error('the getter ran')
      }
    }
    Gate.policy(PostModel, ThrowingGetter)
    expect(await allows(user, 'create', post)).toBe(false)
    // The descriptor is read, the accessor is not: no policy code runs while the ability is looked up
    expect(reads).toBe(0)
    await expect(authorize(user, 'create', post)).rejects.toBeInstanceOf(ForbiddenException)
    expect(reads).toBe(0)
  })

  it('still allows an own arrow function field, which is a data property', async () => {
    class FieldPolicy {
      field = () => true
    }
    Gate.policy(PostModel, FieldPolicy)
    expect(await allows(user, 'field', post)).toBe(true)
    await expect(authorize(user, 'field', post)).resolves.toBeUndefined()
  })
})

describe('Gate.policy inside a request (#394)', () => {
  class RequestPolicy {
    update() {
      return true
    }
  }

  const message = '[@laratype/auth] Gate.policy: register policies in a service provider, not inside a request.'

  it('refuses, and neither another request nor the app sees the policy', async () => {
    const first = app.createRequestScope()
    await ContextApi.run({ container: first } as never, async () => {
      expect(() => Gate.policy(Comment, RequestPolicy)).toThrow(message)
      // Gate.define() registers nothing, so it stays usable inside a request
      expect(Gate.define('inside-a-request', () => true).name).toBe('inside-a-request')
    })

    const second = app.createRequestScope()
    await ContextApi.run({ container: second } as never, async () => {
      await expect(allows(user, 'update', new Comment())).rejects.toThrow('no policy is defined for Comment')
    })

    expect(GateManager.current().policyFor(Comment)).toBeUndefined()
    await first.dispose()
    await second.dispose()
  })

  it('refuses inside a request store that has no container, and still allows at boot', async () => {
    // A hand-mounted handler or a test app can run with a request store but no container: the store is the test
    await ContextApi.run({ request: {} } as never, async () => {
      expect(() => Gate.policy(Comment, RequestPolicy)).toThrow(message)
    })
    expect(() => Gate.policy(Comment, RequestPolicy)).not.toThrow()
  })
})
