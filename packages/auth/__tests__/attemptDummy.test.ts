// The dummy-hash cache and the async check with custom Hashers; this file's guard module starts with a cold cache
import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'vitest'
import { Container, Facade, depsRegistry } from '@laratype/core'
import { ContextApi, Hasher } from '@laratype/support'
import { Auth, AuthManager } from '../src'

type Row = { id: number; [key: string]: any }

/** The slice of a typeorm Model that attempt() reads, over rows in memory. */
const fakeModel = (rows: Row[]) => {
  class User {
    static readonly passwordField = 'password'
    static getRepository() {
      return {
        metadata: {
          primaryColumns: [{ propertyName: 'id' }],
          findColumnWithPropertyName: (name: string) => (name === 'password' ? { propertyPath: 'password', isSelect: false } : undefined),
        },
        update: async () => ({ affected: 1 }),
      }
    }
    static createQueryBuilder() {
      let where: Record<string, unknown> = {}
      const query = {
        where(value: Record<string, unknown>) {
          where = value
          return query
        },
        addSelect() {
          return query
        },
        async getOne() {
          const row = rows.find((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value))
          return row ? Object.assign(new User(), row) : null
        },
      }
      return query
    }
    static getId(user: Row) {
      return user.id
    }
  }
  return { User }
}

const configOf = (provider: unknown) => ({
  default: { guard: 'web' },
  guards: {
    web: {
      strategyName: 'local',
      strategy: class {},
      options: { usernameField: 'email', passwordField: 'password' },
      provider,
      verification: 'jwt',
    },
  },
})

/** Runs one `Auth.guard('web').attempt()`, flattened to the user or `null`, as a caller sees it. */
const attempt = (provider: unknown, fields: Record<string, any>): Promise<any> => {
  const container = new Container({ deps: depsRegistry })
  container.instance(AuthManager, new AuthManager(configOf(provider) as any))
  return ContextApi.run({ container } as any, async () => {
    const authenticated = await Auth.guard<any>('web').attempt(fields)
    return authenticated ? authenticated.getUser() : null
  }) as unknown as Promise<any>
}

/** Makes `hasher` the implementation the Hash facade resolves, as a provider binding does. */
const usingHasher = (hasher: Hasher) => {
  const app = new Container({ deps: depsRegistry })
  app.instance(Hasher, hasher)
  Facade.setFacadeApplication(app)
}

afterEach(() => Facade.setFacadeApplication(undefined))

describe('TokenGuard.attempt() with a custom Hasher', () => {
  it('retries a rejected dummy-hash build instead of caching the rejection', async () => {
    class Broken extends Hasher {
      calls = 0
      override async makeAsync(): Promise<string> {
        this.calls += 1
        throw new Error('the hasher is down')
      }
    }
    const hasher = new Broken()
    usingHasher(hasher)
    const { User } = fakeModel([])

    await expect(attempt(User, { email: 'nobody@example.com', password: 'secret' })).rejects.toThrow('the hasher is down')
    await expect(attempt(User, { email: 'nobody@example.com', password: 'secret' })).rejects.toThrow('the hasher is down')
    expect(hasher.calls).toBe(2)
  })

  it('shares one pending dummy-hash build between concurrent unknown users', async () => {
    class Slow extends Hasher {
      calls = 0
      override async makeAsync(value: string): Promise<string> {
        this.calls += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return super.makeAsync(value)
      }
    }
    const hasher = new Slow()
    usingHasher(hasher)
    const { User } = fakeModel([])

    const [first, second] = await Promise.all([
      attempt(User, { email: 'ada@example.com', password: 'secret' }),
      attempt(User, { email: 'bob@example.com', password: 'secret' }),
    ])
    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(hasher.calls).toBe(1)
  })

  it('denies a checkAsync answer that is truthy but not true', async () => {
    class Truthy extends Hasher {
      override async checkAsync(): Promise<boolean> {
        return 'yes' as unknown as boolean
      }
    }
    usingHasher(new Truthy())
    const { User } = fakeModel([{ id: 1, email: 'ada@example.com', password: 'stored' }])

    expect(await attempt(User, { email: 'ada@example.com', password: 'secret' })).toBeNull()
  })
})
