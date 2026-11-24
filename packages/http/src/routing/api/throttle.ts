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
 * Where the rate limit keeps its counters: one fixed window per key. `mount()` gives each mount its own
 * `MemoryThrottleStore`; the cache (#166) implements it later.
 */
export interface ThrottleStore {
  /**
   * Counts one hit on `key`, starting a window of `windowMs` when there is none or the last one ended. `clientPrefix`
   * is the IPv4 address or IPv6 /48 the store may use to bound one client's share.
   */
  hit(key: string, windowMs: number, clientPrefix: string): ThrottleHit | Promise<ThrottleHit>;
}

/** How often the memory store drops ended windows, so keys seen once don't stay forever. */
const SWEEP_MS = 60_000;

/** The most windows the memory store keeps: past it the window that ends first is dropped, so clients can't exhaust the heap. */
const MAX_WINDOWS = 100_000;

/**
 * The floor of the per-client-prefix cap: one client has one window per throttled route, so `mount()` raises the cap to
 * the mount's throttled-route count plus one; a small mount keeps this floor. A client with an IPv6 /48 can rotate
 * 65,536 /64 buckets, so rotation is still bounded by the cap.
 */
export const MIN_WINDOWS_PER_PREFIX = 1_024;

interface Window {
  hits: number;
  resetAt: number;
  windowMs: number;
  prefix: string;
}

/**
 * The counters in this process's memory: fixed windows, the ended ones dropped at most once a minute. Capacity is
 * counted per client prefix (an IPv4 address, or an IPv6 /48), so the /64s of one /48 share one budget: a prefix at its
 * cap drops its own window that ends first, which can be another /64 of the same /48 (a co-tenant on a cloud range).
 * An eviction fails open for the evicted client only (its limit restarts early): the counters stay per /64 bucket, so a
 * co-tenant never adds hits to another /64's window and cannot cause its 429, and another prefix is untouched below the
 * global cap. A full store drops the window that ends first (an ended one if there is one, else the live one nearest its
 * end), whichever prefix it is. Fair eviction at both levels is tracked in #418.
 */
export class MemoryThrottleStore implements ThrottleStore {
  private readonly windows = new Map<string, Window>();
  // The keys of each window length in start order: within one length, the window started first ends first
  private readonly byLength = new Map<number, Set<string>>();
  // The keys of each client prefix, so a prefix at its cap evicts inside itself: no scan of the whole store for one client
  private readonly byPrefix = new Map<string, Set<string>>();
  private nextSweep = 0;

  constructor(private readonly maxWindows = MAX_WINDOWS, private readonly maxWindowsPerPrefix = MIN_WINDOWS_PER_PREFIX) {}

  hit(key: string, windowMs: number, clientPrefix: string): ThrottleHit {
    const now = Date.now();
    if (now >= this.nextSweep) this.sweep(now);
    let window = this.windows.get(key);
    if (window === undefined || window.resetAt <= now) {
      if (window !== undefined) this.drop(key, window);
      let prefixWindows = this.byPrefix.get(clientPrefix);
      if (prefixWindows === undefined) this.byPrefix.set(clientPrefix, (prefixWindows = new Set()));
      if (prefixWindows.size >= this.maxWindowsPerPrefix) this.evictPrefix(prefixWindows);
      if (this.windows.size >= this.maxWindows) this.evict();
      // Either eviction may have dropped this prefix's last window, taking its set with it: take it again for the new key
      prefixWindows = this.byPrefix.get(clientPrefix);
      if (prefixWindows === undefined) this.byPrefix.set(clientPrefix, (prefixWindows = new Set()));
      window = { hits: 0, resetAt: now + windowMs, windowMs, prefix: clientPrefix };
      this.windows.set(key, window);
      let keys = this.byLength.get(windowMs);
      if (keys === undefined) this.byLength.set(windowMs, (keys = new Set()));
      keys.add(key);
      prefixWindows.add(key);
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

  /**
   * Drops the window of one prefix that ends first: a scan of at most `maxWindowsPerPrefix` keys, and only when that
   * prefix is full. The prefix is shared by the /64s of one /48, so this can drop another /64's window (a co-tenant on a
   * cloud range); an eviction fails open for the evicted client only (its limit restarts early), never adds a hit to
   * another /64's counter, and never touches another prefix below the global cap. Fair eviction at both levels: #418.
   */
  private evictPrefix(keys: Set<string>) {
    let first: [string, Window] | undefined;
    for (const key of keys) {
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
    const prefixWindows = this.byPrefix.get(window.prefix)!;
    prefixWindows.delete(key);
    if (prefixWindows.size === 0) this.byPrefix.delete(window.prefix);
  }

  private sweep(now: number) {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.drop(key, window);
    this.nextSweep = now + SWEEP_MS;
  }
}

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
 * The capacity unit of one client: the IPv4 address, or the /48 of an IPv6 /64 bucket. A client can rotate 65,536 /64
 * addresses inside its /48, and each throttled route adds one window per bucket, so capacity is counted per /48 to keep
 * one client from filling the store and evicting another client's windows.
 */
export const clientPrefix = (bucket: string): string => {
  const suffix = "::/64";
  if (!bucket.endsWith(suffix)) return bucket;
  return `${bucket.slice(0, -suffix.length).split(":").slice(0, 3).join(":")}::/48`;
};

/**
 * Set once the missing-source warning printed: per process, as the throttle has no handle on the Hono app instance and
 * a dev restart or a second copy of the module re-imports this one. The flag is per process, so a second app that also
 * mounts nothing is covered by the first warning.
 */
const NO_CONN_INFO_WARNED = Symbol.for("laratype.http.throttleNoConnInfoWarned");

/**
 * Set once the found-no-address warning printed, per process for the same reason as `NO_CONN_INFO_WARNED`: a registered
 * getter that finds no address can be a deployment fact (a unix socket) or a getter for another runtime.
 */
const NO_ADDRESS_WARNED = Symbol.for("laratype.http.throttleNoAddressWarned");

/** Prints `text` the first time this process reaches the warning flagged by `flag`. */
const warnOnce = (flag: symbol, text: string) => {
  const store = globalThis as { [key: symbol]: true | undefined };
  if (store[flag]) return;
  store[flag] = true;
  console.warn(text);
};

const warnNoConnInfo = (name: string) =>
  warnOnce(NO_CONN_INFO_WARNED, `[@laratype/http] Route.api: no getConnInfo is registered, so .throttle() routes serve requests without a limit: a Bun or custom entry must call mountConnInfo(app, getConnInfo from hono/bun or @hono/node-server/conninfo) before the routes are mounted (first: ${name})`);

const warnNoAddress = (name: string) =>
  warnOnce(NO_ADDRESS_WARNED, `[@laratype/http] Route.api: the registered getConnInfo found no client address (a unix socket or named pipe, or a getter for another runtime), so .throttle() routes serve such requests without a limit; behind a proxy or a unix socket the limit needs the trusted-proxy setting (#320) (first: ${name})`);

/** The numeric status of the empty answer a closed connection gets: the client is gone and cannot receive a body. */
const NO_CONTENT = 204 as const

/**
 * Whether the client's connection is already gone before its address was read (H30 #299 round 4). A reset connection
 * leaves the node adapter's socket `destroyed`; the request signal is aborted only when something read it before the
 * close, so both are checked. A `c.env` that throws on a read is treated as live: a unix socket with no address keeps
 * the warning-and-handle behaviour, and the check never fails the request.
 */
const connectionClosed = (c: Context): boolean => {
  try {
    if (c.req.raw.signal?.aborted) return true
    return (c.env as { incoming?: { socket?: { destroyed?: unknown } } } | null | undefined)?.incoming?.socket?.destroyed === true
  }
  catch {
    return false
  }
}

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
export const throttled = (route: ThrottledRoute, options: ThrottleOptions, handle: RouteHandler, store: ThrottleStore): RouteHandler => {
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
      // The client reset its connection before the address was captured (H30 #299 round 4): fail closed, there is no
      // one to answer and a side-effecting handler must not run unthrottled. A live request with no address (a unix
      // socket) keeps the warning and the handler.
      if (source.registered && connectionClosed(c)) return new Response(null, { status: NO_CONTENT });
      // A missing source is app wiring; a registered getter that found no address can be a unix socket or another runtime's
      // getter, and both leave every throttled route without a limit, so each logs once per process
      if (source.registered) warnNoAddress(route.name);
      else warnNoConnInfo(route.name);
      return handle(c, next);
    }
    const { hits, resetAt } = await store.hit(`${scope} ${bucket}`, windowMs, clientPrefix(bucket));
    if (hits > options.limit) throw tooManyRequests(resetAt);
    return handle(c, next);
  };
};
