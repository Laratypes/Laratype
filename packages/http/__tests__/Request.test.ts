import { Controller, Request as LaratypeRequest, RequestKernel, RouteOptions } from "../src/index";
import { HonoRequest } from "hono/request";
import { z } from "zod";
import { expect, it, describe } from 'vitest'
import { start } from "./preStart";
import { ValidationException } from "@laratype/support";

start()

class RequestMock extends LaratypeRequest {
  rules() {
    return z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string(),
    })
  }
}

class ControllerMock extends Controller {
  test() {
    return "Succeeded"
  }
}

const routeMock: RouteOptions = {
  path: '/users',
  method: 'post',
  controller: ControllerMock.prototype.__invoke('test'),
  middleware: [],
  request: RequestMock,
  name: undefined,
  meta: undefined,
}

const getUrl = (path: string) => {
  const url = new URL("http://localhost");
  url.pathname === path;
  return url.href
}

const createFormData = (data: Record<string, any>) => {
  const formData = new FormData();
  for (const key in data) {
    formData.append(key, data[key]);
  }
  return formData;
}

describe('Processed input before forwarding to validate', () => {

  it('Parse FormData', async () => {
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
    const requestInstance = await RequestKernel.processData(request);

    expect(requestInstance.input).toStrictEqual(testData);
  })

  it('Parse json', async () => {
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
    const requestInstance = await RequestKernel.processData(request);

    expect(requestInstance.input).toStrictEqual(testData);
  })

  it('Parse queries', async () => {
    const testData = {
      email: 'test@example.com',
      password: 'password123',
      name: 'John Doe',
    };

    const url = new URL(getUrl(routeMock.path));
    url.search = new URLSearchParams(testData).toString();
    const rawRequest = new Request(url.href)
    const request = new HonoRequest(rawRequest);
    const requestInstance = await RequestKernel.processData(request);

    expect(requestInstance.input).toStrictEqual(testData);
  })

  it('queries should be overwrite by JSON data', async () => {
    const queries = {
      email: 'test@example.com',
      password: 'password123',
      name: 'John Doe',
    };

    const jsonData = {
      name: 'Ily1606',
    }

    const testData = {
      ...queries,
      ...jsonData,
    }

    const url = new URL(getUrl(routeMock.path));
    url.search = new URLSearchParams(queries).toString();
    const rawRequest = new Request(url.href, {
      method: "POST",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testData)
    })
    const request = new HonoRequest(rawRequest);
    const requestInstance = await RequestKernel.processData(request);

    expect(requestInstance.input).toStrictEqual(testData);
  })

  it('queries should be overwrite by FormData', async () => {
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
    const requestInstance = await RequestKernel.processData(request);

    expect(requestInstance.input).toStrictEqual(testData);
  })

});

describe('Request validation', () => {
  it('Request should be has validate data if it\'s success validation', async () => {
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
    const requestInstance = await RequestKernel.processValidation(request, routeMock);

    expect(requestInstance.validated()).toStrictEqual(testData);
  })
  
  it('Validate failed with rules should be throw ValidationException', async () => {
    const testData = {
      email: 'test',
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

    await expect(() => RequestKernel.processValidation(request, routeMock)).rejects.toThrowError(ValidationException);
  })
  
  it('Validate failed with rules should be return http status 422', async () => {
    const testData = {
      email: 'test',
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

    RequestKernel.processValidation(request, routeMock).catch((err: ValidationException) => {
      expect(err.getHttpCode()).toBe(422);
    })

  })
  
  describe('Controller', () => {
    it('Controller should be called', async () => {
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
      const requestInstance = await RequestKernel.processValidation(request, routeMock);
      const controller = RequestKernel.controllerKernel(routeMock.controller)
      expect(controller(requestInstance)).toBe('Succeeded');
  
    });
  })
})