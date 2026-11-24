// #273: a reportable Exception is reported once, by the exception filter. Constructing one has no side effects.
import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Console } from "@laratype/console";
import { Container, depsRegistry } from "@laratype/core";
import { Exception, HTTP_APP } from "@laratype/support";
import { defineApi, defineContract, defineError, endpoint } from "@laratype/contract";
import { Controller, RequestKernel, ResponseKernel, Route } from "../../src/index";

const anything = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) } } as const;

// A 4xx is reported only when it is reportable (a 5xx is reported anyway), so the count pins the flag itself
const CardDeclined = defineError(409, "CARD_DECLINED");

const payments = defineContract()({
  pay: endpoint.post("/").throws(CardDeclined).response(anything),
});
const paymentsApi = defineApi({ payments: { contract: payments, path: "/api/payments", scopes: [] } });

/** The error a test threw last, so the count is checked against that very object. */
let thrown: Exception;

const declined = (options: { reportable?: boolean } = {}) =>
  new Exception({ code: "CARD_DECLINED", message: "The card was declined.", httpCode: 409, responsible: true, ...options });

class Payments extends Controller {
  pay() { throw (thrown = declined()); }
}

class Legacy extends Controller {
  index() { throw (thrown = declined()); }
}

class Quiet extends Controller {
  index() { throw (thrown = declined({ reportable: false })); }
}

/** An app booted like `sauf dev`: RequestKernel puts the container on each request, ResponseKernel handles errors. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry });
  const app = new Hono();
  container.instance(HTTP_APP, app);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  return app;
};

// console.error is the channel resolveException reports on; Console.error is the one the constructor used to call
let reports: ReturnType<typeof vi.spyOn>;
let constructorReports: ReturnType<typeof vi.spyOn>;

const quiet = () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  reports = vi.spyOn(console, "error").mockImplementation(() => {});
  constructorReports = vi.spyOn(Console, "error").mockImplementation(() => {});
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Exception reporting (#273)", () => {
  it("reports a reportable Exception exactly once from a Route.api route, and the constructor reports nothing", async () => {
    quiet();
    const app = bootApp();
    Route.api(paymentsApi, (r) => [r.contract(payments, Payments)]).mount(app);

    const response = await app.request("/api/payments", { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "CARD_DECLINED", message: "The card was declined." });
    expect(reports).toHaveBeenCalledTimes(1);
    expect(reports).toHaveBeenCalledWith(thrown);
    expect(constructorReports).not.toHaveBeenCalled();
  });

  it("reports a reportable Exception exactly once from a 0.5 route, and the constructor reports nothing", async () => {
    quiet();
    const app = bootApp();
    app.get("/legacy", RequestKernel.handle({ method: "get", path: "/legacy", controller: [Legacy, "index"] }));

    const response = await app.request("/legacy");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "CARD_DECLINED", message: "The card was declined." });
    expect(reports).toHaveBeenCalledTimes(1);
    expect(reports).toHaveBeenCalledWith(thrown);
    expect(constructorReports).not.toHaveBeenCalled();
  });

  it("does not report a non-reportable Exception through a route (unchanged behaviour, pinned)", async () => {
    quiet();
    const app = bootApp();
    app.get("/quiet", RequestKernel.handle({ method: "get", path: "/quiet", controller: [Quiet, "index"] }));

    const response = await app.request("/quiet");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "CARD_DECLINED", message: "The card was declined." });
    expect(reports).not.toHaveBeenCalled();
    expect(constructorReports).not.toHaveBeenCalled();
  });
});
