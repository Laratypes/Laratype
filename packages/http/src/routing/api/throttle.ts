import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { isIP } from "node:net";
import { errors } from "@laratype/contract";
import type { Duration, ThrottleOptions } from "@laratype/contract";
import { clientIp } from "../../supports/Request";

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

/**
 * The counters in this process's memory: fixed windows, the ended ones dropped at most once a minute. Past
 * `maxWindows` the windows started first are dropped, so their clients start a new window early.
 */
export class MemoryThrottleStore implements ThrottleStore {
  // In the order the windows started: a new window is re-inserted at the end
  private readonly windows = new Map<string, { hits: number; resetAt: number }>();
  private nextSweep = 0;

  constructor(private readonly maxWindows = MAX_WINDOWS) {}

  hit(key: string, windowMs: number): ThrottleHit {
    const now = Date.now();
    if (now >= this.nextSweep) this.sweep(now);
    let window = this.windows.get(key);
    if (window === undefined || window.resetAt <= now) {
      this.windows.delete(key);
      if (this.windows.size >= this.maxWindows) this.windows.delete(this.windows.keys().next().value!);
      window = { hits: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }
    window.hits++;
    return { hits: window.hits, resetAt: window.resetAt };
  }

  private sweep(now: number) {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
    this.nextSweep = now + SWEEP_MS;
  }
}

const memoryStore = new MemoryThrottleStore();

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** `per` in ms: seconds, or `"<n>s|m|h|d"` (checked by `checkThrottle` of the contract). */
export const durationMs = (per: Duration): number =>
  (typeof per === "number" ? per : Number.parseFloat(per) * UNIT_SECONDS[per.slice(-1) as keyof typeof UNIT_SECONDS]) * 1000;

/** The eight 16-bit groups of a valid IPv6 address (zone id removed), an embedded IPv4 counting as two. */
const hextets = (ip: string): number[] => {
  const groups = (part: string) =>
    part === ""
      ? []
      : part.split(":").flatMap((group) => {
          if (!group.includes(".")) return [Number.parseInt(group, 16)];
          const [a, b, c, d] = group.split(".").map(Number) as [number, number, number, number];
          return [(a << 8) | b, (c << 8) | d];
        });
  const [head = "", tail] = ip.split("::");
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
};

/**
 * The client's bucket from `request.ip()` (the socket peer, never `X-Forwarded-For`), or `undefined` when there is no
 * address: a shared `""` bucket would let one client throttle every other client without one. An IPv4 address carried
 * in IPv6 (`::ffff:203.0.113.5` from a dual-stack listener, `64:ff9b::203.0.113.5` from a SIIT/NAT64 translator) is
 * that IPv4 address, and any other IPv6 client is its /64, the block one client can rotate addresses in.
 */
export const ipBucket = (ip: string): string | undefined => {
  if (ip === "") return undefined;
  const address = ip.split("%")[0]!;
  if (isIP(address) !== 6) return address;
  const groups = hextets(address);
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const translated = groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0);
  if (mapped || translated) {
    return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
};

/** Set once the missing-address warning printed: per process, as dev restarts and a second copy of the module re-import this one. */
const NO_ADDRESS_WARNED = Symbol.for("laratype.http.throttleNoAddressWarned");

const warnNoAddress = (name: string) => {
  const store = globalThis as { [NO_ADDRESS_WARNED]?: true };
  if (store[NO_ADDRESS_WARNED]) return;
  store[NO_ADDRESS_WARNED] = true;
  console.warn(`[@laratype/http] Route.api: a request has no client address (another runtime, or an in-process app.request()), so rate-limited routes serve such requests without a limit (first: ${name})`);
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
  // At most MAX_SAFE_INTEGER ms, so the window ends and Retry-After is written as plain digits
  if (!(windowMs > 0 && windowMs <= Number.MAX_SAFE_INTEGER)) {
    throw new Error(`[@laratype/http] Route.api: ${route.name}: throttle per must be a positive duration of at most ${Number.MAX_SAFE_INTEGER} ms, got ${String(options.per)}`);
  }
  // The limit and window are part of the key: a dev restart that changes them doesn't keep the old window
  const scope = `${route.method.toUpperCase()} ${route.domain ?? "*"} ${route.path} ${options.limit}/${windowMs}`;
  return async (c, next) => {
    const bucket = ipBucket(clientIp(c));
    if (bucket === undefined) {
      warnNoAddress(route.name);
      return handle(c, next);
    }
    const { hits, resetAt } = await store.hit(`${scope} ${bucket}`, windowMs);
    if (hits > options.limit) throw tooManyRequests(resetAt);
    return handle(c, next);
  };
};
