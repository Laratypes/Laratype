// Type tests for the G2 type watch (docs/v1/typegen.md › Watch mode in sauf dev). Run by the `types` project.
import { describe, expectTypeOf, test } from "vitest";
import { ContractTypeWatch, ContractTypeWatchHost } from "../../src/typegen";
import type { ApiPluginApi, ContractTypeWatchOptions, WatchEvents } from "../../src/typegen";

declare const events: WatchEvents;
declare const tree: Pick<ApiPluginApi, "affectsTree" | "isGenerated" | "refresh">;

describe("ContractTypeWatch types", () => {
  test("takes a tree source and exposes idle() and dispose()", () => {
    const watch = new ContractTypeWatch({ events, tree, delay: 10, onError: () => {} });
    expectTypeOf(watch).toEqualTypeOf<ContractTypeWatch>();
    expectTypeOf(watch.idle()).toEqualTypeOf<Promise<void>>();
    expectTypeOf(watch.dispose()).toEqualTypeOf<void>();
  });

  test("the host opens one watch and reports whether one is live", () => {
    const host = new ContractTypeWatchHost();
    expectTypeOf(host.open({ events, tree })).toEqualTypeOf<ContractTypeWatch>();
    expectTypeOf(host.active).toEqualTypeOf<boolean>();
    expectTypeOf(host.close()).toEqualTypeOf<void>();
  });

  test("requires refresh() on the tree source", () => {
    // @ts-expect-error the type watch needs refresh() to generate
    new ContractTypeWatch({ events, tree: { affectsTree: () => true, isGenerated: () => false } });
  });
});
