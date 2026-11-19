// Copy of the G1 snapshot packages/sauf/__tests__/typegen/__snapshots__/api.ts (#133, CL8 #259): the only API file a
// separate-repo FE has. Self-contained: no contract library, no schema library.

export type AppApi = {
  users: {
    index: {
      method: 'get';
      path: '/api/users';
      params: {};
      query: {
        page?: number | undefined;
      };
      body: undefined;
      headers: undefined;
      response: {
        id: number;
        name: string;
        role: 'admin' | 'member';
        address: {
          street: string;
          zip?: string | undefined;
        };
        tags: string[];
        pair: [number, string];
        meta: Record<string, boolean>;
        createdAt: Date;
      }[];
      status: 200;
      errors: {
        status: 422;
        code: 'VALIDATION_ERROR';
        body: {
          errors: Record<string, string[]>;
          message: string;
        };
      } | {
        status: 401;
        code: 'UNAUTHORIZED';
        body: {
          message: string;
        };
      } | {
        status: 429;
        code: 'TOO_MANY_REQUESTS';
        body: {
          message: string;
        };
      };
    };
    show: {
      method: 'get';
      path: '/api/users/:user';
      params: {
        user: string;
      };
      query: undefined;
      body: undefined;
      headers: undefined;
      response: {
        id: number;
        name: string;
        role: 'admin' | 'member';
        address: {
          street: string;
          zip?: string | undefined;
        };
        tags: string[];
        pair: [number, string];
        meta: Record<string, boolean>;
        createdAt: Date;
      };
      status: 200;
      errors: {
        status: 401;
        code: 'UNAUTHORIZED';
        body: {
          message: string;
        };
      } | {
        status: 429;
        code: 'TOO_MANY_REQUESTS';
        body: {
          message: string;
        };
      } | {
        status: 404;
        code: 'NOT_FOUND';
        body: {
          message: string;
        };
      };
    };
    store: {
      method: 'post';
      path: '/api/users';
      params: {};
      query: undefined;
      body: {
        name: string;
        email: string;
      };
      headers: undefined;
      response: {
        id: number;
        name: string;
        role: 'admin' | 'member';
        address: {
          street: string;
          zip?: string | undefined;
        };
        tags: string[];
        pair: [number, string];
        meta: Record<string, boolean>;
        createdAt: Date;
      };
      status: 201;
      errors: {
        status: 422;
        code: 'VALIDATION_ERROR';
        body: {
          errors: Record<string, string[]>;
          message: string;
        };
      } | {
        status: 401;
        code: 'UNAUTHORIZED';
        body: {
          message: string;
        };
      } | {
        status: 429;
        code: 'TOO_MANY_REQUESTS';
        body: {
          message: string;
        };
      } | {
        status: 409;
        code: 'EMAIL_TAKEN';
        body: {
          message: string;
          email: string;
        };
      };
    };
    destroy: {
      method: 'delete';
      path: '/api/users/:user';
      params: {
        user: string;
      };
      query: undefined;
      body: undefined;
      headers: undefined;
      response: undefined;
      status: 202;
      errors: {
        status: 401;
        code: 'UNAUTHORIZED';
        body: {
          message: string;
        };
      } | {
        status: 429;
        code: 'TOO_MANY_REQUESTS';
        body: {
          message: string;
        };
      } | {
        status: 404;
        code: 'NOT_FOUND';
        body: {
          message: string;
        };
      };
    };
    posts: {
      index: {
        method: 'get';
        path: '/api/users/:user/posts';
        params: {
          user: string;
        };
        query: undefined;
        body: undefined;
        headers: undefined;
        response: {
          id: number;
          title: string;
        }[];
        status: 200;
        errors: {
          status: 401;
          code: 'UNAUTHORIZED';
          body: {
            message: string;
          };
        } | {
          status: 429;
          code: 'TOO_MANY_REQUESTS';
          body: {
            message: string;
          };
        } | {
          status: 404;
          code: 'NOT_FOUND';
          body: {
            message: string;
          };
        } | {
          status: 403;
          code: 'ACCOUNT_LOCKED';
          body: {
            message: string;
          };
        };
      };
      update: {
        method: 'patch';
        path: '/api/users/:user/posts/:post';
        params: {
          user: string;
          post: string;
        };
        query: undefined;
        body: {
          title: string;
        };
        headers: undefined;
        response: {
          id: number;
          title: string;
        };
        status: 200;
        errors: {
          status: 422;
          code: 'VALIDATION_ERROR';
          body: {
            errors: Record<string, string[]>;
            message: string;
          };
        } | {
          status: 401;
          code: 'UNAUTHORIZED';
          body: {
            message: string;
          };
        } | {
          status: 429;
          code: 'TOO_MANY_REQUESTS';
          body: {
            message: string;
          };
        } | {
          status: 404;
          code: 'NOT_FOUND';
          body: {
            message: string;
          };
        } | {
          status: 403;
          code: 'ACCOUNT_LOCKED';
          body: {
            message: string;
          };
        } | {
          status: 403;
          code: 'FORBIDDEN';
          body: {
            message: string;
          };
        } | {
          status: 410;
          code: 'NOT_FOUND';
          body: {
            message: string;
          };
        };
      };
    };
  };
  v1: {
    health: {
      check: {
        method: 'get';
        path: '/api/v1/health';
        params: {};
        query: undefined;
        body: undefined;
        headers: undefined;
        response: {
          ok: boolean;
        };
        status: 200;
        errors: never;
      };
    };
  };
}

/** Route name → method, full path, success status, whether the success has a body, and the error codes with their statuses. */
export const manifest = {
  'users.destroy': { method: 'delete', path: '/api/users/:user', status: 202, response: false, errors: [{ status: 404, code: 'NOT_FOUND' }, { status: 429, code: 'TOO_MANY_REQUESTS' }, { status: 401, code: 'UNAUTHORIZED' }] },
  'users.index': { method: 'get', path: '/api/users', status: 200, response: true, errors: [{ status: 429, code: 'TOO_MANY_REQUESTS' }, { status: 401, code: 'UNAUTHORIZED' }, { status: 422, code: 'VALIDATION_ERROR' }] },
  'users.posts.index': { method: 'get', path: '/api/users/:user/posts', status: 200, response: true, errors: [{ status: 403, code: 'ACCOUNT_LOCKED' }, { status: 404, code: 'NOT_FOUND' }, { status: 429, code: 'TOO_MANY_REQUESTS' }, { status: 401, code: 'UNAUTHORIZED' }] },
  'users.posts.update': { method: 'patch', path: '/api/users/:user/posts/:post', status: 200, response: true, errors: [{ status: 403, code: 'ACCOUNT_LOCKED' }, { status: 403, code: 'FORBIDDEN' }, { status: 404, code: 'NOT_FOUND' }, { status: 410, code: 'NOT_FOUND' }, { status: 429, code: 'TOO_MANY_REQUESTS' }, { status: 401, code: 'UNAUTHORIZED' }, { status: 422, code: 'VALIDATION_ERROR' }] },
  'users.show': { method: 'get', path: '/api/users/:user', status: 200, response: true, errors: [{ status: 404, code: 'NOT_FOUND' }, { status: 429, code: 'TOO_MANY_REQUESTS' }, { status: 401, code: 'UNAUTHORIZED' }] },
  'users.store': { method: 'post', path: '/api/users', status: 201, response: true, errors: [{ status: 409, code: 'EMAIL_TAKEN' }, { status: 429, code: 'TOO_MANY_REQUESTS' }, { status: 401, code: 'UNAUTHORIZED' }, { status: 422, code: 'VALIDATION_ERROR' }] },
  'v1.health.check': { method: 'get', path: '/api/v1/health', status: 200, response: true, errors: [] },
} as const
