import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { isIP } from "node:net";
import { errors } from "@laratype/contract";
import type { Duration, ThrottleOptions } from "@laratype/contract";
import { connInfoSource } from "../../supports/Request";
import { hextets, ipv4FromHextets } from "../../supports/ip";

/** The hits counted in a key's current window, and when that window ends (epoch ms). */
export interface ThrottleHit {
  readonly hits: number;
  readonly resetAt: number;
}

/**
 * Where the rate limit keeps its counters: one fixed window per key. The cache (#166) implements it later; until then
 * every route uses one `MemoryThrottleStore` per process.
 */
export interface ThrottleStore {
  /** Counts one hit on `key`, starting a window of `windowMs` when there is none or the last one ended. */
  hit(key: string, windowMs: number): ThrottleHit | Promise<ThrottleHit>;
}

/** How often the memory store drops ended windows, so keys seen once don't stay forever. */
const SWEEP_MS = 60_000;

/** The most windows the memory store keeps: past it the oldest are dropped, so many clients can't exhaust the heap. */
const MAX_WINDOWS = 100_000;

interface Window {
  hits: number;
  resetAt: number;
  windowMs: number;
}

/**
 * The counters in this process's memory: fixed windows, the ended ones dropped at most once a minute. A full store
 * drops the window that ends first: an ended one if there is one, else the live one nearest its end, whose client
 * starts a new window early.
 */
export class MemoryThrottleStore implements ThrottleStore {
  private readonly windows = new Map<string, Window>();
  // The keys of each window length in start order: within one length, the window started first ends first
  private readonly byLength = new Map<number, Set<string>>();
  private nextSweep = 0;

  constructor(private readonly maxWindows = MAX_WINDOWS) {}

  hit(key: string, windowMs: number): ThrottleHit {
    const now = Date.now();
    if (now >= this.nextSweep) this.sweep(now);
    let window = this.windows.get(key);
    if (window === undefined || window.resetAt <= now) {
      if (window !== undefined) this.drop(key, window);
      if (this.windows.size >= this.maxWindows) this.evict();
      window = { hits: 0, resetAt: now + windowMs, windowMs };
      this.windows.set(key, window);
      let keys = this.byLength.get(windowMs);
      if (keys === undefined) this.byLength.set(windowMs, (keys = new Set()));
      keys.add(key);
    }
    window.hits++;
    return { hits: window.hits, resetAt: window.resetAt };
  }

  /** Drops the window that ends first, found among the oldest window of each length: no scan of the whole store. */
  private evict() {
    let first: [string, Window] | undefined;
    for (const keys of this.byLength.values()) {
      const key = keys.values().next().value!;
      const window = this.windows.get(key)!;
      if (first === undefined || window.resetAt < first[1].resetAt) first = [key, window];
    }
    if (first !== undefined) this.drop(...first);
  }

  private drop(key: string, window: Window) {
    this.windows.delete(key);
    const keys = this.byLength.get(window.windowMs)!;
    keys.delete(key);
    if (keys.size === 0) this.byLength.delete(window.windowMs);
  }

  private sweep(now: number) {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.drop(key, window);
    this.nextSweep = now + SWEEP_MS;
  }
}

const memoryStore = new MemoryThrottleStore();

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** `per` in ms: seconds, or `"<n>s|m|h|d"` (checked by `checkThrottle` of the contract). */
export const durationMs = (per: Duration): number =>
  (typeof per === "number" ? per : Number.parseFloat(per) * UNIT_SECONDS[per.slice(-1) as keyof typeof UNIT_SECONDS]) * 1000;

/**
 * The client's bucket from `request.ip()` (the socket peer, never `X-Forwarded-For`), or `undefined` when there is no
 * address: a shared bucket would let one client throttle every other client without one. An IPv4 address carried in
 * IPv6 is that IPv4 address: `::ffff:203.0.113.5` (a dual-stack listener), `64:ff9b::203.0.113.5` (NAT64),
 * `::ffff:0:203.0.113.5` (SIIT) and `::203.0.113.5` (IPv4-compatible, except `::` and `::1`). Any other IPv6 client is
 * its /64, the block one client can rotate addresses in.
 */
export const ipBucket = (ip: string | undefined): string | undefined => {
  if (ip === undefined || ip === "") return undefined;
  const address = ip.split("%")[0]!;
  if (isIP(address) !== 6) return address;
  const groups = hextets(address);
  const leadingZeros = (count: number) => groups.slice(0, count).every((group) => group === 0);
  const mapped = leadingZeros(5) && groups[5] === 0xffff;
  const siit = leadingZeros(4) && groups[4] === 0xffff && groups[5] === 0;
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0);
  // ::a.b.c.d, whose embedded 0.0.0.0 and 0.0.0.1 are :: and ::1, the unspecified and loopback addresses
  const compatible = leadingZeros(6) && !(groups[6] === 0 && (groups[7] === 0 || groups[7] === 1));
  if (mapped || siit || nat64 || compatible) {
    return ipv4FromHextets(groups[6]!, groups[7]!);
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
};

/**
 * Set once the missing-source warning printed: per process, as the throttle has no handle on the Hono app instance and
 * a dev restart or a second copy of the module re-imports this one. The flag is per process, so a second app that also
 * mounts nothing is covered by the first warning.
 */
const NO_CONN_INFO_WARNED = Symbol.for("laratype.http.throttleNoConnInfoWarned");

const warnNoConnInfo = (name: string) => {
  const store = globalThis as { [NO_CONN_INFO_WARNED]?: true };
  if (store[NO_CONN_INFO_WARNED]) return;
  store[NO_CONN_INFO_WARNED] = true;
  console.warn(`[@laratype/http] Route.api: no getConnInfo is registered, so .throttle() routes serve requests without a limit: a Bun or custom entry must call mountConnInfo(app, getConnInfo from hono/bun or @hono/node-server/conninfo) before the routes are mounted (first: ${name})`);
};

/**
 * Set once the found-no-address warning printed, per process for the same reason as `NO_CONN_INFO_WARNED`: a registered
 * getter that finds no address can be a deployment fact (a unix socket) or a getter for another runtime.
 */
const NO_ADDRESS_WARNED = Symbol.for("laratype.http.throttleNoAddressWarned");

const warnNoAddress = (name: string) => {
  const store = globalThis as { [NO_ADDRESS_WARNED]?: true };
  if (store[NO_ADDRESS_WARNED]) return;
  store[NO_ADDRESS_WARNED] = true;
  console.warn(`[@laratype/http] Route.api: the registered getConnInfo found no client address (a unix socket or named pipe, or a getter for another runtime), so .throttle() routes serve such requests without a limit; behind a proxy or a unix socket the limit needs the trusted-proxy setting (#320) (first: ${name})`);
};

/** The catalog 429 on the wire (`{ code, ...body }`, http.md › Exceptions), built once: it never changes. */
const TOO_MANY_REQUESTS = (() => {
  const error = errors.tooManyRequests();
  return { status: error.status, message: error.message, body: JSON.stringify({ code: error.code, ...error.body }) };
})();

/** The catalog 429 with `Retry-After`, as a Hono `HTTPException`. */
const tooManyRequests = (resetAt: number) => {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  const res = new Response(TOO_MANY_REQUESTS.body, {
    status: TOO_MANY_REQUESTS.status,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
  });
  return new HTTPException(TOO_MANY_REQUESTS.status, { res, message: TOO_MANY_REQUESTS.message });
};

type RouteHandler = (c: Context, next: Next) => Promise<Response | void>;

/** The route a counter belongs to: method, host and path, so same-named routes of two groups or domains never share one. */
export interface ThrottledRoute {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly domain: string | undefined;
}

/**
 * Applies a route's resolved `throttle` before its handler (docs/v1/http.md › Rate limiting): each route counts its own
 * hits per client, and the hit past `limit` in a window of `per` answers 429. Requests with no client address are
 * not limited.
 */
export const throttled = (route: ThrottledRoute, options: ThrottleOptions, handle: RouteHandler, store: ThrottleStore = memoryStore): RouteHandler => {
  const windowMs = durationMs(options.per);
  // The contract's range (checkThrottle): a shorter window never limits, a longer one never ends
  if (!(windowMs >= 1000 && windowMs <= Number.MAX_SAFE_INTEGER)) {
    throw new Error(`[@laratype/http] Route.api: ${route.name}: throttle per must be from 1 second to ${Number.MAX_SAFE_INTEGER} ms, got ${String(options.per)}`);
  }
  // The limit and window are part of the key: a dev restart that changes them doesn't keep the old window
  const scope = `${route.method.toUpperCase()} ${route.domain ?? "*"} ${route.path} ${options.limit}/${windowMs}`;
  return async (c, next) => {
    const source = connInfoSource(c);
    const bucket = ipBucket(source.address);
    if (bucket === undefined) {
      // A missing source is app wiring; a registered getter that found no address can be a unix socket or another runtime's
      // getter, and both leave every throttled route without a limit, so each logs once per process
      if (source.registered) warnNoAddress(route.name);
      else warnNoConnInfo(route.name);
      return handle(c, next);
    }
    const { hits, resetAt } = await store.hit(`${scope} ${bucket}`, windowMs);
    if (hits > options.limit) throw tooManyRequests(resetAt);
    return handle(c, next);
  };
};
