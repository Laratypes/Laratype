/**
 * A canonical positive safe-integer route id, or null. `0x1`, `1e0`, `01`, `+1`, a value above 2^53 and every
 * non-numeric string are misses, so a route never looks up a rounded id.
 */
export const parseRouteId = (raw: string): number | null => {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
};
