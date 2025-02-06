import { Request as LaratypeRequest, RequestKernel, RouteOptions } from "../../src/index";
import { HonoRequest } from "hono/request";
import { z } from "zod";
import { expect, it, test, describe } from 'vitest'
import { start } from "../preStart";

start()

class RequestMock extends LaratypeRequest {
  rules() {
    return z.object({
      email: z.string(),
      password: z.string().min(8),
      name: z.string(),
    })
  }
}

const routeMock: RouteOptions = {
  path: '/users',
  method: 'post',
  controller: () => { },
  middleware: [],
  request: RequestMock,
  name: undefined,
  meta: undefined,
}

const getUrl = (path: string) => {
  const url = new URL("http://localhost");
  url.pathname = path;
  return url.href
}

const createFormData = (data: Record<string, any>) => {
  const formData = new FormData();
  for (const key in data) {
    formData.append(key, data[key]);
  }
  return formData;
}

describe('Test request facade methods', () => {
  describe('isMethod()', () => {
    test('should be GET', () => {
      const rawRequest = new Request(getUrl(routeMock.path));
      const request = new HonoRequest(rawRequest);
      const frameworkRequest = RequestKernel.transformRequest(request, routeMock)

      expect(frameworkRequest.isMethod('GET')).toBe(true);
    });

    test('should be POST', () => {
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: 'POST',
      });
      const request = new HonoRequest(rawRequest);
      const frameworkRequest = RequestKernel.transformRequest(request, routeMock)

      expect(frameworkRequest.isMethod('POST')).toBe(true);
    });

    test('should be PUT', () => {
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: 'PUT',
      });
      const request = new HonoRequest(rawRequest);
      const frameworkRequest = RequestKernel.transformRequest(request, routeMock)

      expect(frameworkRequest.isMethod('PUT')).toBe(true);
    });

    test('should be PATCH', () => {
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: 'PATCH',
      });
      const request = new HonoRequest(rawRequest);
      const frameworkRequest = RequestKernel.transformRequest(request, routeMock)

      expect(frameworkRequest.isMethod('PATCH')).toBe(true);
    });

    test('should be DELETE', () => {
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: 'DELETE',
      });
      const request = new HonoRequest(rawRequest);
      const frameworkRequest = RequestKernel.transformRequest(request, routeMock)

      expect(frameworkRequest.isMethod('DELETE')).toBe(true);
    });

    test('should be OPTIONS', () => {
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: 'OPTIONS',
      });
      const request = new HonoRequest(rawRequest);
      const frameworkRequest = RequestKernel.transformRequest(request, routeMock)

      expect(frameworkRequest.isMethod('OPTIONS')).toBe(true);
    });
  });

  describe('all()', () => {
    test('application/json', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.all()).toStrictEqual(testData);
    });

    test('FormData', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        body: createFormData(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.all()).toStrictEqual(testData);
    });

    test('Empty data', async () => {
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.all()).toStrictEqual({});
    });

    test('queries', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const url = new URL(getUrl(routeMock.path));
      url.search = new URLSearchParams(testData).toString();
      const rawRequest = new Request(url.href)
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.all()).toStrictEqual(testData);
    });

    test('Combined queries and JSON', async () => {
      const queries = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };

      const formData = {
        name: 'Ily1606',
      }

      const testData = {
        ...queries,
        ...formData,
      }

      const url = new URL(getUrl(routeMock.path));
      url.search = new URLSearchParams(queries).toString();
      const rawRequest = new Request(url.href, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.all()).toStrictEqual(testData);
    });

    test('Combined queries and FormData', async () => {
      const queries = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };

      const formData = {
        name: 'Ily1606',
      }

      const testData = {
        ...queries,
        ...formData,
      }

      const url = new URL(getUrl(routeMock.path));
      url.search = new URLSearchParams(queries).toString();
      const rawRequest = new Request(url.href, {
        method: "POST",
        body: createFormData(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.all()).toStrictEqual(testData);
    });
  });

  describe('input()', async () => {
    test('If argument is empty, return all', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.input()).toStrictEqual(testData);
    });

    test('Return data from specify keys', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.input(['email', 'name', 'gender'])).toStrictEqual({
        email: 'test@example.com',
        name: 'John Doe',
      });
    });
  });

  describe('except()', () => {
    test('If argument is array [], return all', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.except([])).toStrictEqual(testData);
    });

    test('Return all except specified keys', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.except(['password', 'gender'])).toStrictEqual({
        email: 'test@example.com',
        name: 'John Doe',
      });
    });
  });

  describe('has()', () => {
    it('If argument is array [], return true', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.has([])).toBe(true);
    });

    it('All elements has in request, return true', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.has(['email', 'password'])).toBe(true);
    });

    it('At least one element not in request, return false', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.has(['email', 'fullname'])).toBe(false);
    });
  });

  describe('hasAny()', () => {
    it('If argument is array [], return true', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.hasAny([])).toBe(true);
    });

    it('At least one element in request, return true', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.hasAny(['email', 'fullname'])).toBe(true);
    });
  });

  describe('hasHeader()', () => {
    it('If argument has in request header, return true', async () => {
      const rawRequest = new Request(getUrl(routeMock.path), {
        headers: {
          'Authorization': 'Bearer xxxx'
        }
      })
      const request = new HonoRequest(rawRequest);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.hasHeader('Authorization')).toBe(true);
    });
  });

  describe('headers()', () => {
    it('Get all headers from request', async () => {
      const headers = {
        'Authorization': 'Bearer xxxx',
        'Content-Type': 'application/json',
        'X-Custom-Header': 'value1',
      }
      const rawRequest = new Request(getUrl(routeMock.path), {
        headers,
      })
      const request = new HonoRequest(rawRequest);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.headers()).toStrictEqual(Object.fromEntries(Object.entries(headers).map((el) => [el[0].toLowerCase(), el[1]])));
    });
  });

  describe('header()', () => {
    it('Get header with specify argument', async () => {
      const headers = {
        'Authorization': 'Bearer xxxx',
        'Content-Type': 'application/json',
        'X-Custom-Header': 'value1',
      }
      const rawRequest = new Request(getUrl(routeMock.path), {
        headers,
      })
      const request = new HonoRequest(rawRequest);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.header('Authorization')).toBe(headers.Authorization);
    });

    it('If not present on header, return undefined', async () => {
      const headers = {
        'Authorization': 'Bearer xxxx',
        'Content-Type': 'application/json',
        'X-Custom-Header': 'value1',
      }
      const rawRequest = new Request(getUrl(routeMock.path), {
        headers,
      })
      const request = new HonoRequest(rawRequest);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.header('Origin')).toBe(undefined);
    });
  });

  describe('only()', () => {
    it('If argument is array [], return []', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.only([])).toStrictEqual({});
    });

    it('Get data with specify keys', async () => {
      const testData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'John Doe',
      };
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.only(['email', 'password', 'test'])).toStrictEqual({
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });
  
  describe('path()', () => {
    it('Get path of current request', async () => {
      const rawRequest = new Request(getUrl(routeMock.path), {
        method: "GET",
      })
      const request = new HonoRequest(rawRequest, routeMock.path);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.path()).toBe(routeMock.path);
    });
  });
  
  describe('query()', () => {
    const testData = {
      email: 'test@example.com',
      password: 'password123',
      name: 'John Doe',
    };
    const url = new URL(getUrl(routeMock.path));
    url.search = new URLSearchParams(testData).toString();
    const rawRequest = new Request(url.href, {
      method: "POST",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ test: "ok" })
    })
    const request = new HonoRequest(rawRequest, routeMock.path);
    
    it('Get all queries', async () => {
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);
      expect(requestInstance.query()).toStrictEqual(testData);
    });
    
    it('Get query with specify key', async () => {
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);
      expect(requestInstance.query('email')).toBe(testData.email);
    });
    
    it('If it not present on queries, return undefined', async () => {
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);
      expect(requestInstance.query('test')).toBe(undefined);
    });
  });

  describe('url()', () => {
    it('Get url of current request', async () => {
      const rawRequest = new Request(getUrl(routeMock.path))
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.url()).toBe(getUrl(routeMock.path));
    });
  });
  
  describe('method()', () => {
    it('Get method of current request', async () => {
      const rawRequest = new Request(getUrl(routeMock.path))
      const request = new HonoRequest(rawRequest);
      await RequestKernel.processData(request);
      const requestInstance = RequestKernel.transformRequest(request, routeMock);

      expect(requestInstance.method()).toBe("GET");
    });
  });

});