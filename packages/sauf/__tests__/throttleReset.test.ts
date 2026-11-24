// H30 #299 round 4: mountConnInfo captures the address when its middleware runs, so a client that writes a request
// and resets its connection during a later global middleware's await still gets its throttled route counted.
import "reflect-metadata";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { Container, depsRegistry } from "@laratype/core";
import { HTTP_APP } from "@laratype/support";
import { defineApi, defineContract, endpoint } from "@laratype/contract";
import { Controller, RequestKernel, ResponseKernel, Route } from "@laratype/http";
import { mountNodeConnInfo } from "../src/adapters/node/connInfo";

const anything = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) } } as const
const otp = defineContract()({
  send: endpoint.get("/send").response(anything).throttle({ limit: 1, per: "1m" }),
})
const appApi = defineApi({ otp: { contract: otp, path: "/api/otp", scopes: [] } })

/** The side effect the throttled handler makes: one per request that reaches it, never more than the limit. */
let sends = 0
class OtpController extends Controller {
  send() {
    sends++
    return { sent: true }
  }
}

/** How many requests the first middleware has seen, and how many the test waits for before it resets. */
let started = 0

/** Bounded wait: the test never polls without a deadline. */
const waitFor = async (predicate: () => boolean, timeoutMs = 2_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  return predicate()
}

/**
 * The app `sauf`'s node entry serves: the address getter mounted first, then a 100 ms global middleware, then the
 * throttled route. The middleware stands in for a session, auth or request-log load before the route.
 */
const bootApp = async () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  await mountNodeConnInfo(app, async () => await import("@laratype/http"))
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  app.use("*", async (_c, next) => {
    started++
    await new Promise((resolve) => setTimeout(resolve, 100))
    await next()
  })
  Route.api(appApi, (r) => [r.contract(otp, OtpController)]).mount(app)
  return app
}

/** Writes a GET and resets the connection once the server's first middleware has the request, as the repro does. */
const resetRequest = async (port: number, path: string, count: number): Promise<void> => {
  const socket = net.connect(port, "127.0.0.1")
  socket.on("error", () => {})
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()))
  socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)
  // The capture has run when the next middleware starts; the reset lands during its await
  await waitFor(() => started >= count)
  socket.resetAndDestroy()
  await closed
}

const close = (server: ServerType) => new Promise<void>((resolve) => server.close(() => resolve()))

describe("a throttled route on the node adapter", () => {
  let server: ServerType
  let origin = ""
  let port = 0

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    const app = await bootApp()
    server = await new Promise<ServerType>((resolve) => {
      const listening = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info: AddressInfo) => {
        port = info.port
        origin = `http://127.0.0.1:${info.port}`
        resolve(listening)
      })
    })
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await close(server)
  })

  it("counts the address captured before the await, so reset requests never run the handler past the limit", async () => {
    const requests = 5
    for (let i = 0; i < requests; i++) await resetRequest(port, "/api/otp/send", i + 1)
    expect(started).toBe(requests)
    // The first reset request's handler runs after its middleware's await; the other four are past the limit
    await waitFor(() => sends > 0)
    expect(sends).toBeLessThanOrEqual(1)
    // The store kept the captured 127.0.0.1 bucket: a live request is the second hit, not a fresh start
    const live = await fetch(`${origin}/api/otp/send`)
    expect(live.status).toBe(429)
    expect(sends).toBe(1)
  })
})
