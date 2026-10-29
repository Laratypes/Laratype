// Type tests (D8 #115): the `Log` facade forwards to `LogManager`, and `Log.fake()` takes a LogManager.
import { describe, expectTypeOf, it } from "vitest";
import { Log, LogManager } from "../src";

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {};

describe("Log facade", () => {
  it("forwards the LogManager accessor and its methods", () => {
    expectTypeOf(Log.accessor).toEqualTypeOf<typeof LogManager>();
    expectTypeOf(Log.getLogger).toEqualTypeOf<LogManager["getLogger"]>();
    expectTypeOf(Log.format).toEqualTypeOf<LogManager["format"]>();
    expectTypeOf(Log.info).toEqualTypeOf<LogManager["info"]>();
    expectTypeOf(Log.error).toEqualTypeOf<LogManager["error"]>();
    expectTypeOf(Log.warn).toEqualTypeOf<LogManager["warn"]>();
    expectTypeOf(Log.debug).toEqualTypeOf<LogManager["debug"]>();
    expectTypeOf(Log.emergency).toEqualTypeOf<LogManager["emergency"]>();
    expectTypeOf(Log.alert).toEqualTypeOf<LogManager["alert"]>();
    expectTypeOf(Log.critical).toEqualTypeOf<LogManager["critical"]>();
  });

  it("takes a LogManager in fake() and returns a restore function", () => {
    expectTypeOf(Log.fake(new LogManager())).toEqualTypeOf<() => void>();
  });

  it("rejects a fake that is not a LogManager", () => {
    typeOnly(() => {
      // @ts-expect-error the fake must implement LogManager
      Log.fake({});
    });
  });
});
