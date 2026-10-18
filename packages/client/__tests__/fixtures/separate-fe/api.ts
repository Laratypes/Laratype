// Copy of the G1 snapshot packages/sauf/__tests__/typegen/__snapshots__/api.ts (#133): the only API file a separate-repo FE has.
// Self-contained: no contract library, no schema library.

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
        name: string;
        id: number;
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
        name: string;
        id: number;
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
        name: string;
        id: number;
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

/** Route name → method, full path and the error codes the endpoint can answer with. */
export const manifest = {
  'users.index': { method: 'get', path: '/api/users', errors: ['TOO_MANY_REQUESTS', 'UNAUTHORIZED', 'VALIDATION_ERROR'] },
  'users.posts.index': { method: 'get', path: '/api/users/:user/posts', errors: ['ACCOUNT_LOCKED', 'NOT_FOUND', 'TOO_MANY_REQUESTS', 'UNAUTHORIZED'] },
  'users.posts.update': { method: 'patch', path: '/api/users/:user/posts/:post', errors: ['ACCOUNT_LOCKED', 'FORBIDDEN', 'NOT_FOUND', 'TOO_MANY_REQUESTS', 'UNAUTHORIZED', 'VALIDATION_ERROR'] },
  'users.show': { method: 'get', path: '/api/users/:user', errors: ['NOT_FOUND', 'TOO_MANY_REQUESTS', 'UNAUTHORIZED'] },
  'users.store': { method: 'post', path: '/api/users', errors: ['EMAIL_TAKEN', 'TOO_MANY_REQUESTS', 'UNAUTHORIZED', 'VALIDATION_ERROR'] },
  'v1.health.check': { method: 'get', path: '/api/v1/health', errors: [] },
} as const
