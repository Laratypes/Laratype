// A4 #151: guards resolved from the app container, booted like `sauf dev` with the auth flows of examples/basic
import 'reflect-metadata'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import jsonwebtoken from 'jsonwebtoken'
import LocalStrategy from 'passport-local'
import { config, Container, depsRegistry, Facade } from '@laratype/core'
import { bootProviders, ConfigLoadServiceProvider, ContextApi, EnvLoadServiceProvider, HTTP_APP, Hash, InternalException, ModelBindingRegistry, ServiceProvider, setAppManifest, type AppManifest, type LaratypeConfig } from '@laratype/support'
import { Controller, Middleware, RequestKernel, ResponseKernel, type Request } from '@laratype/http'
import { AUTH_CONFIG, Auth, AuthGuard, AuthManager, AuthVerification, Passport, PassportGuard, PassportServiceProvider, PassportStrategy, TokenGuard } from '../src'

const passwordColumn = { propertyPath: 'password', isSelect: false }
const repository = { metadata: { primaryColumns: [{ propertyName: 'id' }], findColumnWithPropertyName: (name: string) => (name === 'password' ? passwordColumn : undefined) } }

/** The model statics the test models share: rows, the password-column repository and the query of `attempt()`. */
class ModelFixture {
  id!: number
  email!: string
  static rows: ModelFixture[] = []
  static getRepository = () => repository
  static async findOneBy(fields: Record<string, unknown>) {
    return this.rows.find(row => Object.entries(fields).every(([key, value]) => (row as any)[key] === value)) ?? null
  }
  /** The password column is { select: false }: the login adds it to the select, then reads it off the row. */
  static createQueryBuilder(this: typeof ModelFixture, _alias: string) {
    let where: Record<string, unknown> = {}
    const Model = this
    const query = {
      where: (value: Record<string, unknown>) => { where = value; return query },
      addSelect: (_: string) => query,
      getOne: async () => {
        // A typeorm entity, so issueToken() finds the model by the constructor name
        const row = Model.rows.find(row => Object.entries(where).every(([key, value]) => (row as any)[key] === value))
        return row ? Object.assign(new Model(), row) : null
      },
    }
    return query
  }
}

// Two separate models, as examples/basic: an Admin is not a User (A6 #358)
class User extends ModelFixture {
  static override rows: User[] = []
}

class Admin extends ModelFixture {
  static override rows: Admin[] = []
}

/** The PersonalAccessToken model: a token must have a live record. */
class PersonalAccessToken {
  static rows: any[] = []
  static insert = vi.fn(async (row: any) => { PersonalAccessToken.rows.push({ ...row, save: vi.fn() }) })
  static createQueryBuilder = () => {
    let params: { token: string, expires_at: Date }
    const query = {
      where: (_: string, values: typeof params) => { params = values; return query },
      getOne: async () => PersonalAccessToken.rows.find(row => row.token === params.token && row.expires_at > params.expires_at) ?? null,
    }
    return query
  }
}

const make = <T extends ModelFixture>(Model: { new(): T, rows: T[] }, id: number, email: string) => {
  const row = Object.assign(new Model(), { id, email, password: Hash.make('secret') })
  Model.rows.push(row)
  return row
}

const local = { strategyName: 'local', strategy: PassportStrategy.make(LocalStrategy), options: { usernameField: 'email', passwordField: 'password' } }

/** The app key of the tests. */
const KEY = 'a4-test-key'

// examples/basic/app/config/auth.ts, without the google guard (it needs network)
const authConfig = {
  default: { guard: 'web' },
  guards: {
    web: { ...local, provider: User, verification: 'jwt' },
    admin: { ...local, provider: Admin, verification: 'jwt' },
    api: { provider: User, verification: 'jwt' },
  },
} satisfies LaratypeConfig.Auth

const entry = (name: string, value: unknown) => ({ name, path: `app/${name}.ts`, load: async () => ({ default: value }) })

const manifest = (withTokenModel = true): AppManifest => ({
  configs: [entry('auth', authConfig)],
  models: withTokenModel ? [entry('PersonalAccessToken', PersonalAccessToken)] : [],
  routes: [], commands: [], migrations: [], seeders: [], factories: [], modules: [],
})

class LocalAuthentication extends Middleware {
  async handle(_: Request, res: any, next: any) {
    return (await Passport.authenticate('web', {}))(res, next)
  }
}

class AdminLocalAuthentication extends Middleware {
  async handle(_: Request, res: any, next: any) {
    return (await Passport.authenticate('admin', {}))(res, next)
  }
}

// The controllers of examples/basic: LoginController, AdminLoginController, UserController.me
class LoginController extends Controller {
  async login() {
    const authenticated = Auth.user<any>()
    if (!authenticated) return { user: null }
    return { user: authenticated.getUser(), token: await authenticated.generateToken({ name: 'Default Token', abilities: '*' }) }
  }

  async manualLogin(request: Request) {
    const attempt = await Auth.guard<any>('web').attempt(request.all())
    if (!attempt) return { user: null }
    return { user: attempt.getUser(), token: await attempt.generateToken({ name: 'Default Token', abilities: '*' }) }
  }

  async adminLogin() {
    // No guard name: Auth.user() must bind the guard AdminLocalAuthentication authenticated with (A6 #335)
    const authenticated = Auth.user<any>()
    if (!authenticated) return { user: null }
    return { user: authenticated.getUser(), token: await authenticated.generateToken({ name: 'Default Token', abilities: '*' }) }
  }

  async adminRelogin() {
    const authenticated = Auth.user<any>()
    if (!authenticated) return { user: null }
    const relogged = Auth.login<any>(authenticated.getUser())
    return { user: relogged.getUser(), token: await relogged.generateToken({ name: 'Default Token', abilities: '*' }) }
  }

  me() {
    return { user: ContextApi.getUser() }
  }
}

const boot = async (withTokenModel = true) => {
  setAppManifest(manifest(withTokenModel))
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  // The TypeORM entities `DatabaseServiceProvider` registers, for TokenGuard's tokenable_type lookup (D7 #114)
  const registry = new ModelBindingRegistry()
  registry.models = { User, Admin, PersonalAccessToken }
  container.instance(ModelBindingRegistry, registry)
  await bootProviders(container, [RequestKernel, PassportServiceProvider, ResponseKernel])
  app.post('/login', RequestKernel.handle({ method: 'post', path: '/login', controller: [LoginController, 'login'], middleware: [LocalAuthentication] }))
  app.post('/login/manual', RequestKernel.handle({ method: 'post', path: '/login/manual', controller: [LoginController, 'manualLogin'] }))
  app.post('/admin/login', RequestKernel.handle({ method: 'post', path: '/admin/login', controller: [LoginController, 'adminLogin'], middleware: [AdminLocalAuthentication] }))
  app.post('/admin/login/again', RequestKernel.handle({ method: 'post', path: '/admin/login/again', controller: [LoginController, 'adminRelogin'], middleware: [AdminLocalAuthentication] }))
  app.get('/me', RequestKernel.handle({ method: 'get', path: '/me', controller: [LoginController, 'me'], middleware: [AuthGuard] }))
  return { app, container }
}

const post = (app: Hono, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const me = (app: Hono, token: string) => app.request('/me', { headers: { Authorization: `Bearer ${token}` } })

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  globalThis.__laratype_config = { key: KEY }
  User.rows = []
  Admin.rows = []
  PersonalAccessToken.rows = []
})

afterEach(() => {
  vi.restoreAllMocks()
  // bootProviders() makes its container the facade application when none is set: don't leak it into the next test
  Facade.setFacadeApplication(undefined)
})

afterAll(() => {
  delete (globalThis as any).__laratype_manifest
  delete (globalThis as any).__laratype_config
  delete (globalThis as any).__laratype_configs
})

describe('PassportServiceProvider', () => {
  it('binds AUTH_CONFIG and an AuthManager singleton', async () => {
    const { container } = await boot()
    expect(container.make(AUTH_CONFIG)).toBe(authConfig)
    expect(container.make(AuthManager)).toBe(container.make(AuthManager))
    expect(container.make(AuthManager).config).toBe(authConfig)
  })

  it('loads the env file before app/config/auth.ts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'laratype-auth-env-'))
    writeFileSync(join(dir, '.env'), 'A4_AUTH_ENV=loaded\n')
    vi.spyOn(process, 'cwd').mockReturnValue(dir)
    try {
      let seen: string | undefined
      setAppManifest({
        ...manifest(),
        configs: [{
          name: 'auth',
          path: 'app/config/auth.ts',
          load: async () => {
            seen = process.env.A4_AUTH_ENV
            return { default: authConfig }
          },
        }, entry('config', { name: 'app' })],
      })
      const container = new Container({ deps: depsRegistry })
      await bootProviders(container, [EnvLoadServiceProvider, ConfigLoadServiceProvider, PassportServiceProvider])
      expect(seen).toBe('loaded')
    }
    finally {
      delete process.env.A4_AUTH_ENV
      delete (globalThis as any).__laratype_env_file
      delete (globalThis as any).__laratype_configs
      delete (globalThis as any).__laratype_config
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("binds app/config/auth.ts before K1's config store fills config('auth')", async () => {
    setAppManifest({ ...manifest(), configs: [entry('auth', authConfig), entry('config', { name: 'app' })] })
    try {
      // Every register() runs before any boot(), so at this point ConfigLoadServiceProvider has not run
      expect(() => config('auth')).toThrow('ran before the configs were loaded')
      const container = new Container({ deps: depsRegistry })
      await bootProviders(container, [EnvLoadServiceProvider, ConfigLoadServiceProvider, PassportServiceProvider])
      // ... and both hold the one auth config once auth.ts is evaluated
      expect(container.make(AUTH_CONFIG)).toBe(authConfig)
      expect(config('auth')).toBe(authConfig)
    }
    finally {
      delete (globalThis as any).__laratype_configs
      delete (globalThis as any).__laratype_config
    }
  })

  it('registers the strategy of each passport guard under its name', async () => {
    const use = vi.spyOn(Passport.passport, 'use')
    await boot()
    expect(use.mock.calls.map(([name]) => name)).toEqual(['web', 'admin'])
  })

  it('fails the boot without app/config/auth.ts', async () => {
    setAppManifest({ ...manifest(), configs: [] })
    const container = new Container({ deps: depsRegistry })
    await expect(bootProviders(container, [PassportServiceProvider])).rejects.toThrow('app/config/auth.ts not found')
  })

  it('binds AUTH_CONFIG and AuthManager before every provider boot()', async () => {
    setAppManifest(manifest())
    const container = new Container({ deps: depsRegistry })
    container.instance(HTTP_APP, new Hono())
    let seen: unknown[] = []
    class Probe extends ServiceProvider {
      boot() { seen = [this.app.make(AUTH_CONFIG), this.app.make(AuthManager)] }
    }
    await bootProviders(container, [PassportServiceProvider, Probe])
    expect(seen).toEqual([authConfig, container.make(AuthManager)])
  })
})

describe('AuthVerification', () => {
  it('resolves a named guard from the app container', async () => {
    const { container } = await boot()
    await ContextApi.run({ container } as any, () => {
      expect(AuthVerification.guard('admin')).toBe(container.make(AuthManager).guard('admin'))
    })
  })
})

describe('AuthManager', () => {
  const manager = new AuthManager(authConfig)

  it('builds the default guard when no name is given', () => {
    expect(manager.defaultGuard).toBe('web')
    expect(manager.guard().name).toBe('web')
    expect(manager.guard()).toBe(manager.guard('web'))
  })

  it('caches one guard per name', () => {
    expect(manager.guard('admin')).toBe(manager.guard('admin'))
    expect(manager.guard('admin')).not.toBe(manager.guard('web'))
  })

  it('builds a PassportGuard for a config with a strategy, else a TokenGuard', () => {
    expect(manager.guard('web')).toBeInstanceOf(PassportGuard)
    expect(manager.guard('api')).toBeInstanceOf(TokenGuard)
    expect(manager.guard('api')).not.toBeInstanceOf(PassportGuard)
    expect(manager.guard('admin').config).toBe(authConfig.guards.admin)
  })

  it('throws for a guard that is not in the config', () => {
    expect(() => manager.guard('missing')).toThrow('[@laratype/auth] Auth guard "missing" is not defined in app/config/auth.ts.')
    expect(() => manager.guard('toString')).toThrow('Auth guard "toString" is not defined')
  })
})

describe('TokenGuard', () => {
  const guard = new TokenGuard('api', authConfig.guards.api)
  // A token record's tokenable_type resolves through ModelBindingRegistry (D7 #114): these tests build the guard
  // outside boot(), so they get a facade application holding the models (the top-level afterEach clears it)
  let models: Record<string, unknown>
  beforeEach(() => {
    const container = new Container({ deps: depsRegistry })
    const registry = new ModelBindingRegistry()
    registry.models = { User, Admin, PersonalAccessToken }
    container.instance(ModelBindingRegistry, registry)
    Facade.setFacadeApplication(container)
    models = registry.models
  })

  it('reads the token through request.bearerToken() only', () => {
    expect(guard.token({ bearerToken: () => 'valid.token' } as unknown as Request)).toBe('valid.token')
    expect(guard.token({ bearerToken: () => '' } as unknown as Request)).toBeUndefined()
  })

  it('answers the user of the request token, or false', async () => {
    const user = { id: 1 } as any
    const verify = vi.spyOn(guard, 'verify').mockResolvedValue(user)
    const request = { bearerToken: () => 'valid.token' } as unknown as Request
    await expect(guard.user(request)).resolves.toBe(user)
    expect(verify).toHaveBeenCalledWith('valid.token')

    verify.mockResolvedValue(false)
    await expect(guard.user(request)).resolves.toBe(false)
    await expect(guard.user({ bearerToken: () => '' } as unknown as Request)).resolves.toBe(false)
  })

  it('signs its tokens with HS256', async () => {
    const token = await guard.issueToken(make(User, 1, 'ada@example.com'), { name: 'Default Token', abilities: '*' })
    // issueToken() pins the algorithm instead of relying on jsonwebtoken's default
    expect((jsonwebtoken.decode(token, { complete: true }) as any).header.alg).toBe('HS256')
  })

  it('answers a real model instance from user()', async () => {
    const token = await guard.issueToken(make(User, 1, 'ada@example.com'), { name: 'Default Token', abilities: '*' })
    const verified = await guard.user({ bearerToken: () => token } as unknown as Request)
    expect(verified).toBeInstanceOf(User)
    expect(verified).toMatchObject({ id: 1, email: 'ada@example.com' })
  })

  it('refuses to sign an Admin with a User guard', async () => {
    const admin = make(Admin, 2, 'root@example.com')
    // The default guard's provider is User: this token would verify as User#2
    const token = new TokenGuard('web', authConfig.guards.web).issueToken(admin, { name: 'Default Token', abilities: '*' })
    await expect(token).rejects.toBeInstanceOf(InternalException)
    await expect(token).rejects.toThrow('[@laratype/auth] Guard "web" issues tokens for User, not Admin.')
  })

  it('refuses to sign a User with an Admin guard', async () => {
    const user = make(User, 1, 'ada@example.com')
    const token = new TokenGuard('admin', authConfig.guards.admin).issueToken(user, { name: 'Default Token', abilities: '*' })
    await expect(token).rejects.toBeInstanceOf(InternalException)
    await expect(token).rejects.toThrow('[@laratype/auth] Guard "admin" issues tokens for Admin, not User.')
  })

  it('refuses a user that is not a model instance with an InternalException', async () => {
    for (const user of [null, undefined, { id: 1 }, 'User']) {
      await expect(guard.issueToken(user as any, { name: 'Default Token', abilities: '*' })).rejects.toBeInstanceOf(InternalException)
    }
  })

  it('signs a token for a subclass of the provider', async () => {
    class SuperAdmin extends Admin {
      static override rows: SuperAdmin[] = []
    }
    models.SuperAdmin = SuperAdmin

    const guard = new TokenGuard('admin', authConfig.guards.admin, PersonalAccessToken as any)
    const superAdmin = make(SuperAdmin, 9, 'root@example.com')
    const token = await guard.issueToken(superAdmin, { name: 'Default Token', abilities: '*' })
    // The record keeps the real model; the model it names is a subclass of the provider
    expect(PersonalAccessToken.rows[0]).toMatchObject({ tokenable_type: 'SuperAdmin', tokenable_id: 9 })
    await expect(guard.verify(token)).resolves.toMatchObject({ id: 9, email: 'root@example.com' })
    // The token names the user's own model, which the record names too
    expect((jsonwebtoken.decode(token) as any).payload.type).toBe('SuperAdmin')
  })

  it('refuses a subclass of the provider without a token record', async () => {
    // Its own table: verify() would load Admin#9 by the signed id, a different row than SuperAdmin#9
    class SuperAdmin extends Admin {
      static override rows: SuperAdmin[] = []
    }
    const guard = new TokenGuard('admin', authConfig.guards.admin)
    const token = guard.issueToken(make(SuperAdmin, 9, 'root@example.com'), { name: 'Default Token', abilities: '*' })
    await expect(token).rejects.toBeInstanceOf(InternalException)
    await expect(token).rejects.toThrow('[@laratype/auth] Guard "admin" issues tokens for Admin, not SuperAdmin.')
  })

  it('refuses a token record whose model is not the model the token was signed for', async () => {
    class SuperAdmin extends Admin {
      static override rows: SuperAdmin[] = []
    }
    models.SuperAdmin = SuperAdmin
    make(SuperAdmin, 9, 'root@example.com')
    // Signed for Admin#9, stored as SuperAdmin#9: the record would load a different identity than the token names
    const token = jsonwebtoken.sign({ guard: 'admin', payload: { id: 9, type: 'Admin' } }, KEY)
    PersonalAccessToken.rows.push({
      token,
      expires_at: new Date(Date.now() + 60_000),
      verification_type: 'jwt',
      tokenable_type: 'SuperAdmin',
      tokenable_id: 9,
      save: vi.fn(),
    })

    const guard = new TokenGuard('admin', authConfig.guards.admin, PersonalAccessToken as any)
    await expect(guard.verify(token)).resolves.toBe(false)
  })

  it('rejects a token signed for another guard', async () => {
    const user = make(User, 1, 'ada@example.com')
    const token = await new TokenGuard('web', authConfig.guards.web)
      .issueToken(user, { name: 'Default Token', abilities: '*' })
    const admin = new TokenGuard('admin', authConfig.guards.admin)
    await expect(admin.verify(token)).resolves.toBe(false)
  })

  it('rejects a token without a guard claim', async () => {
    make(User, 1, 'ada@example.com')
    // A token from before the claim existed: a valid signature alone no longer authenticates it
    const token = jsonwebtoken.sign({ payload: { id: 1, type: 'User' } }, KEY)
    await expect(guard.verify(token)).resolves.toBe(false)
  })

  it('rejects a token without a model claim', async () => {
    make(User, 1, 'ada@example.com')
    // Tokens issued before the model claim existed carry the right guard and id but no model
    const token = jsonwebtoken.sign({ guard: 'api', payload: { id: 1 } }, KEY)
    await expect(guard.verify(token)).resolves.toBe(false)
  })

  it('rejects a token signed for another model, even with the right secret and guard', async () => {
    make(User, 1, 'ada@example.com')
    const token = jsonwebtoken.sign({ guard: 'api', payload: { id: 1, type: 'Admin' } }, KEY)
    await expect(guard.verify(token)).resolves.toBe(false)
  })

  it('rejects a token signed with another algorithm, even with the same secret', async () => {
    make(User, 1, 'ada@example.com')
    const token = jsonwebtoken.sign({ guard: 'api', payload: { id: 1, type: 'User' } }, KEY, { algorithm: 'HS384' })
    await expect(guard.verify(token)).resolves.toBe(false)
  })

  it('denies a token whose user no longer exists', async () => {
    const token = await guard.issueToken(make(User, 1, 'ada@example.com'), { name: 'Default Token', abilities: '*' })
    User.rows = []
    await expect(guard.verify(token)).resolves.toBe(false)
  })

  it('loads the user by the provider primary key, not always "id"', async () => {
    const row = { uuid: 'acc-1', email: 'ada@example.com' }
    class Account {
      uuid!: string
      email!: string
      static getRepository = () => ({ metadata: { primaryColumns: [{ propertyName: 'uuid' }] } })
      static findOneBy = vi.fn(async (fields: Record<string, unknown>) =>
        Object.entries(fields).every(([key, value]) => (row as any)[key] === value) ? Object.assign(new Account(), row) : null)
    }
    // issueToken() resolves the model by the instance's constructor name
    models.Account = Account

    const guard = new TokenGuard('api', { provider: Account, verification: 'jwt' } as any)
    const token = await guard.issueToken(Object.assign(new Account(), row) as any, { name: 'Default Token', abilities: '*' })
    await expect(guard.verify(token)).resolves.toMatchObject({ uuid: 'acc-1', email: 'ada@example.com' })
    expect(Account.findOneBy).toHaveBeenCalledWith({ uuid: 'acc-1' })
  })

  it('loads a token record user by the tokenable model primary key', async () => {
    const row = { uuid: 'acc-2', email: 'grace@example.com' }
    class Account {
      uuid!: string
      email!: string
      static getRepository = () => ({ metadata: { primaryColumns: [{ propertyName: 'uuid' }] } })
      static findOneBy = vi.fn(async (fields: Record<string, unknown>) =>
        Object.entries(fields).every(([key, value]) => (row as any)[key] === value) ? Object.assign(new Account(), row) : null)
    }
    models.Account = Account

    const record: any = {
      token: 'stored.token',
      expires_at: new Date(Date.now() + 60_000),
      verification_type: 'jwt',
      tokenable_type: 'Account',
      tokenable_id: 'acc-2',
      save: vi.fn(),
    }
    const tokenModel = {
      createQueryBuilder: () => {
        const query = { where: () => query, getOne: async () => record }
        return query
      },
    }
    const guard = new TokenGuard('api', { provider: Account, verification: 'jwt' } as any, tokenModel as any)
    const token = jsonwebtoken.sign({ guard: 'api', payload: { id: 'acc-2', type: 'Account' } }, KEY)

    await expect(guard.verify(token)).resolves.toMatchObject({ uuid: 'acc-2', email: 'grace@example.com' })
    expect(record.save).toHaveBeenCalledOnce()
  })

  it('refuses a token record of a model that is not the provider or a subclass', async () => {
    const admin = make(Admin, 3, 'root@example.com')
    const token = jsonwebtoken.sign({ guard: 'api', payload: { id: admin.id, type: 'User' } }, KEY)
    PersonalAccessToken.rows.push({
      token,
      expires_at: new Date(Date.now() + 60_000),
      verification_type: 'jwt',
      tokenable_type: 'Admin',
      tokenable_id: admin.id,
      save: vi.fn(),
    })

    const guard = new TokenGuard('api', authConfig.guards.api, PersonalAccessToken as any)
    await expect(guard.verify(token)).resolves.toBe(false)
  })
})

describe('PassportGuard', () => {
  it('registers its strategy under the guard name and fails another strategy as in 0.5', () => {
    let verifyCallback: any
    class FakeStrategy {
      constructor(_options: Record<string, unknown>, callback: any) { verifyCallback = callback }
    }
    const guard = new PassportGuard('api', {
      strategy: FakeStrategy as any,
      strategyName: 'google',
      provider: User,
      verification: 'jwt',
    })
    const use = vi.fn()
    guard.register({ use } as any, undefined)
    expect(use).toHaveBeenCalledWith('api', expect.any(FakeStrategy))

    const callback = vi.fn()
    verifyCallback({}, {}, callback)
    expect(callback).toHaveBeenCalledWith(null, false, { message: 'Strategy not implemented' })
  })

  it('refuses a local strategy without both lookup fields', () => {
    const local = (options?: Record<string, unknown>) => new PassportGuard('web', {
      strategy: LocalStrategy as any,
      strategyName: 'local',
      provider: User,
      verification: 'jwt',
      options,
    })
    const use = vi.fn()
    const message = '[@laratype/auth] Auth guard "web": a local strategy needs options.usernameField and options.passwordField.'
    expect(() => local().register({ use } as any, undefined)).toThrow(message)
    expect(() => local({ usernameField: 'email' }).register({ use } as any, undefined)).toThrow(message)
    expect(use).not.toHaveBeenCalled()
    local({ usernameField: 'email', passwordField: 'password' }).register({ use } as any, undefined)
    expect(use).toHaveBeenCalledWith('web', expect.any(LocalStrategy))
  })

  it('refuses passReqToCallback on a local strategy', () => {
    const guard = new PassportGuard('web', {
      strategy: LocalStrategy as any,
      strategyName: 'local',
      provider: User,
      verification: 'jwt',
      options: { usernameField: 'email', passwordField: 'password', passReqToCallback: true },
    })
    const use = vi.fn()
    expect(() => guard.register({ use } as any, undefined))
      .toThrow('[@laratype/auth] Auth guard "web": a local strategy does not support options.passReqToCallback.')
    expect(use).not.toHaveBeenCalled()
  })
})

describe('Auth.login', () => {
  it('signs with the default guard of the app container', async () => {
    const { container } = await boot()
    await ContextApi.run({ container } as any, async () => {
      const user = make(User, 3, 'lin@example.com')
      const authenticated = Auth.login<any>(user)
      const token = await authenticated.generateToken({ name: 'Default Token', abilities: '*' })
      expect(PersonalAccessToken.rows[0]).toMatchObject({ tokenable_type: 'User', tokenable_id: 3, token })
    })
  })

  it('refuses to generate a token for a model that is not the guard provider', async () => {
    const { container } = await boot()
    await ContextApi.run({ container } as any, async () => {
      const admin = make(Admin, 5, 'root@example.com')
      // The default guard's provider is User: the Admin login is refused where the token is signed
      const authenticated = Auth.login<any>(admin)
      await expect(authenticated.generateToken({ name: 'Default Token', abilities: '*' })).rejects.toThrow(
        '[@laratype/auth] Guard "web" issues tokens for User, not Admin.',
      )
      expect(PersonalAccessToken.rows).toEqual([])
    })
  })
})

describe('auth flows of examples/basic', () => {
  it('logs in through the local strategy, then authenticates the issued token', async () => {
    const { app } = await boot()
    const ada = make(User, 1, 'ada@example.com')

    const login = await post(app, '/login', { email: 'ada@example.com', password: 'secret' })
    expect(login.status).toBe(200)
    const { user, token } = await login.json()
    expect(user).toMatchObject({ id: 1, email: 'ada@example.com' })
    expect(PersonalAccessToken.rows).toEqual([expect.objectContaining({ tokenable_type: 'User', tokenable_id: 1, token, verification_type: 'jwt' })])

    const response = await me(app, token)
    expect(response.status).toBe(200)
    expect((await response.json()).user).toMatchObject({ id: ada.id, email: ada.email })
    expect(PersonalAccessToken.rows[0].save).toHaveBeenCalledOnce()
  })

  it('answers the strategy challenge for wrong credentials', async () => {
    const { app } = await boot()
    make(User, 1, 'ada@example.com')
    const login = await post(app, '/login', { email: 'ada@example.com', password: 'wrong' })
    // 0.5 behaviour of the passport framework's strategy.fail(), unchanged by A4
    expect(await login.json()).toEqual({ challenge: { message: 'Incorrect username or password.' } })
    expect(PersonalAccessToken.rows).toEqual([])
  })

  it('logs in with Auth.guard(name).attempt()', async () => {
    const { app } = await boot()
    make(User, 2, 'grace@example.com')
    const login = await post(app, '/login/manual', { email: 'grace@example.com', password: 'secret' })
    const { user, token } = await login.json()
    expect(user).toMatchObject({ id: 2 })
    expect((await (await me(app, token)).json()).user).toMatchObject({ id: 2 })

    const wrong = await post(app, '/login/manual', { email: 'grace@example.com', password: 'nope' })
    expect(await wrong.json()).toEqual({ user: null })
  })

  it('signs the admin token for the guard that authenticated the request', async () => {
    const { app, container } = await boot()
    make(Admin, 7, 'root@example.com')
    const login = await post(app, '/admin/login', { email: 'root@example.com', password: 'secret' })
    const { user, token } = await login.json()
    expect(user).toMatchObject({ id: 7 })
    expect(PersonalAccessToken.rows[0]).toMatchObject({ tokenable_type: 'Admin', tokenable_id: 7 })
    // Auth.user() bound the admin guard Passport.authenticate('admin') ran
    expect((jsonwebtoken.decode(token) as any).guard).toBe('admin')
    // The default web guard rejects the token, and the admin guard accepts it
    expect((await me(app, token)).status).toBe(401)
    await ContextApi.run({ container } as any, async () => {
      expect(await AuthVerification.guard<any>('admin').verify(token)).toMatchObject({ id: 7, email: 'root@example.com' })
    })
  })

  it('signs through Auth.login() for the guard that authenticated the request', async () => {
    const { app } = await boot()
    make(Admin, 8, 'ops@example.com')
    const login = await post(app, '/admin/login/again', { email: 'ops@example.com', password: 'secret' })
    const { token } = await login.json()
    expect((jsonwebtoken.decode(token) as any).guard).toBe('admin')
  })

  it('rejects a token with no live record', async () => {
    const { app } = await boot()
    make(User, 1, 'ada@example.com')
    const { token } = await (await post(app, '/login', { email: 'ada@example.com', password: 'secret' })).json()
    PersonalAccessToken.rows[0].expires_at = new Date(Date.now() - 1000)
    const response = await me(app, token)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED', message: 'Token is invalid or expired.' })
  })

  it('loads the user from the provider model without a PersonalAccessToken model', async () => {
    const { app } = await boot(false)
    make(User, 1, 'ada@example.com')
    const { token } = await (await post(app, '/login', { email: 'ada@example.com', password: 'secret' })).json()
    // The payload id is looked up in the guard's provider model, so the response carries the user, not the JWT
    expect((await (await me(app, token)).json()).user).toMatchObject({ id: 1, email: 'ada@example.com' })
    expect(PersonalAccessToken.rows).toEqual([])
    expect((await me(app, `${token}x`)).status).toBe(401)
  })
})

describe('outside the app container', () => {
  it('Auth and AuthVerification name the missing container', async () => {
    expect(() => AuthVerification.verify('token')).toThrow('[@laratype/auth] No app container')
    await expect(Auth.guard('web').attempt({})).rejects.toThrow('[@laratype/auth] No app container')
    expect(Auth.user()).toBeNull()
  })

  it('a request container without AuthManager names the provider', async () => {
    const container = new Container({ deps: depsRegistry })
    await ContextApi.run({ container } as any, () => {
      expect(() => AuthVerification.verify('token')).toThrow('AuthManager is not bound in the app container: boot PassportServiceProvider')
    })
  })
})
