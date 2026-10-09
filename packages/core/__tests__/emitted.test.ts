import { describe, expect, it, vi } from 'vitest'
import { Container, DiError, depsRegistry, getDeps, hasOwnDeps } from '@laratype/core'
import {
  ChildNoCtor,
  ChildOwnCtor,
  Config,
  GrandChild,
  Keyed,
  MAILER,
  NeedsName,
  Parent,
  Plain,
  Repo,
  Service,
  userHelper,
} from './fixtures/emitted'
import type { Mailer } from './fixtures/emitted'

vi.mock('virtual:laratype/di', () => import('@laratype/core'))

const mailer: Mailer = { send: () => 'sent' }
const container = () => new Container({ deps: depsRegistry }).instance(MAILER, mailer)

describe('T1 emit shape through virtual:laratype/di (aliased import)', () => {
  it('registers every class that has an own constructor', () => {
    expect([Repo, Service, NeedsName, Parent, ChildOwnCtor, Plain, Keyed].every(hasOwnDeps)).toBe(true)
    expect(hasOwnDeps(Config)).toBe(false)
    expect(userHelper('x')).toBe('user:x')
  })

  it('keeps wrapped class expressions intact (helper returns the class)', () => {
    expect(typeof Plain).toBe('function')
    expect(Keyed.name).toBe('Keyed')
    expect(container().make(Plain).repo).toBeInstanceOf(Repo)
    expect(container().make(Keyed).repo).toBeInstanceOf(Repo)
  })

  it('resolves class thunks, token thunks, and optional unresolved slots end to end', () => {
    const service = container().make(Service)
    expect(service.repo).toBeInstanceOf(Repo)
    expect(service.repo.config).toBeInstanceOf(Config)
    expect(service.mailer).toBe(mailer)
    expect(service.name).toBeUndefined()
    expect(service.cache).toBeInstanceOf(Repo)
    expect(getDeps(Service)!.entry.meta).toEqual({ params: ['repo', 'mailer', 'name', 'cache'], optional: [2, 3] })
  })

  it('rejects a required unresolved slot', () => {
    expect(() => container().make(NeedsName)).toThrow(DiError)
    expect(() => container().make(NeedsName)).toThrow('NeedsName constructor param #1 `name`: type `string` has no runtime value')
  })

  it('inherits deps only when the class has no own constructor', () => {
    const c = container()
    expect(c.make(ChildNoCtor).repo).toBeInstanceOf(Repo)
    expect(c.make(GrandChild).repo).toBeInstanceOf(Repo)
    expect(getDeps(GrandChild)!.owner).toBe(Parent)

    const own = c.make(ChildOwnCtor)
    expect(getDeps(ChildOwnCtor)!.owner).toBe(ChildOwnCtor)
    expect(own.config).toBeInstanceOf(Config)
    expect(own.repo.config).toBe(own.config)
  })

  it('works with container bindings and singletons', () => {
    const c = container().singleton(Repo)
    expect(c.make(Service).repo).toBe(c.make(Parent).repo)
  })
})
