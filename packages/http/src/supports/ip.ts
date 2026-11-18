import { isIP } from "node:net"

/**
 * The eight 16-bit groups of a valid IPv6 address (zone id already removed), an embedded IPv4 counting as two groups
 * (docs/v1/http.md › Request.ip()). `isIP()` has accepted the address: the `::` shorthand is expanded, and each group
 * parses as hex.
 */
export const hextets = (ip: string): number[] => {
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

/** The IPv4 address two 16-bit groups carry, as `a.b.c.d`. */
export const ipv4FromHextets = (high: number, low: number): string => [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");

/**
 * An address the registered `getConnInfo` returned, normalized (docs/v1/http.md › Request.ip()), or `undefined` when it
 * is not one: no string, an empty string, or something that is not an IPv4/IPv6 address. An IPv6 zone id (`fe80::1%eth0`,
 * a link-local address on one interface) is stripped, and an IPv4-mapped IPv6 address (`::ffff:203.0.113.7`, any case,
 * as Node's dual-stack listener reports an IPv4 client) becomes that IPv4 address. Anything else is returned unchanged,
 * so ip() never turns text no socket produced into a client address.
 */
export const normalizeIp = (address: unknown): string | undefined => {
  if (typeof address !== "string") return undefined;
  // The scope of a link-local address (`%eth0`, `%3` on Windows) is not part of the address; ip() reports the address
  const zone = address.indexOf("%");
  const plain = zone === -1 ? address : address.slice(0, zone);
  if (plain === "") return undefined;
  const version = isIP(plain);
  if (version === 0) return undefined;
  if (version === 4) return plain;
  const groups = hextets(plain);
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  return mapped ? ipv4FromHextets(groups[6]!, groups[7]!) : plain;
};
