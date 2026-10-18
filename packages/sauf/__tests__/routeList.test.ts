import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract';
import type { ContractPrefix } from '@laratype/contract';
import { Controller, Middleware, Route } from '@laratype/http';
import { Console } from '@laratype/console';
import RouteListCommand, { routeRow } from '../src/commands/route/list';

// `sauf route:list` reads the route registry that Route.api fills (H1 #104)
const root = defineScope()({ auth: true });
const usersUser = defineScope<ContractPrefix<'/api/users/:user', [typeof root]>>()({ authorize: true });
const users = defineContract()({ index: endpoint.get('/') });
const posts = defineContract()({ destroy: endpoint.delete('/:post') });
const appApi = defineApi({
  users: { contract: users, path: '/api/users', scopes: [root], dirs: [''] },
  'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [root, usersUser], dirs: ['', 'users/[user]'] },
});

class UserController extends Controller { index() { return []; } }
class PostController extends Controller { destroy() {} }
class UserScopePolicy {}
class Audit extends Middleware {}

const routes = Route.api(appApi, (r) => [
  r.contract(users, UserController),
  r.scope('users/[user]', { policy: UserScopePolicy }),
  r.middleware(Audit).contract(posts, PostController),
]);

afterEach(() => {
  globalThis.__laratype_routes = undefined;
  vi.restoreAllMocks();
});

describe('sauf route:list', () => {
  it('lists the Route.api registry entries and marks auth that is not enforced yet', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.__laratype_routes = routes.mount(new Hono());
    const table = vi.spyOn(Console, 'table').mockImplementation(() => {});
    const warn = vi.spyOn(Console, 'warn').mockImplementation(() => {});
    expect(await new RouteListCommand().handle()).toBe(0);
    expect(table).toHaveBeenCalledWith([
      { Method: 'get', path: '/api/users', Name: 'users.index', Controller: 'UserController::index', Middleware: '-', Policies: '-', 'Not enforced': 'auth' },
      {
        Method: 'delete', path: '/api/users/:user/posts/:post', Name: 'users.posts.destroy', Controller: 'PostController::destroy',
        Middleware: 'Audit', Policies: 'users/[user]: UserScopePolicy', 'Not enforced': 'auth, authorize',
      },
    ]);
    expect(warn).toHaveBeenCalledWith('The routes with a "Not enforced" value skip those checks: see the [@laratype/http] Route.api warning.');
  });

  it('shows the Domain column when a domain is set', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Console, 'warn').mockImplementation(() => {});
    globalThis.__laratype_routes = routes.domain('api.example.test').mount(new Hono());
    const table = vi.spyOn(Console, 'table').mockImplementation(() => {});
    await new RouteListCommand().handle();
    expect(table.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ Name: 'users.index', Domain: 'api.example.test' }),
      expect.objectContaining({ Name: 'users.posts.destroy', Domain: 'api.example.test' }),
    ]);
  });

  it('still reads 0.5 entries', () => {
    expect(routeRow({ method: 'get', path: '/me', controller: [UserController, 'me'], middleware: [Audit], can: [] })).toEqual({
      Method: 'get', path: '/me', Name: '-', Controller: 'UserController::me', Middleware: 'Audit', Policies: '-', 'Not enforced': '-', Domain: '-',
    });
  });

  it('warns when nothing is registered', async () => {
    const warn = vi.spyOn(Console, 'warn').mockImplementation(() => {});
    expect(await new RouteListCommand().handle()).toBe(0);
    expect(warn).toHaveBeenCalledWith('No routes registered.');
  });
});
