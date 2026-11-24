// H8 #122: the contract policy slot of @laratype/http. @laratype/auth fills it on import; without it mount() fails
// closed. The slot itself is tested with stand-ins: no import of @laratype/auth here.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { defineApi, defineContract, endpoint } from "@laratype/contract";
import type { AnyContract } from "@laratype/contract";
import { Controller, Route, contractPolicies, defineMiddleware, registerContractAuth, registerContractPolicies } from "../../src/index";
import type { ApiRoutes, ContractPolicyChecks } from "../../src/index";

const anything = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) } } as const;
const slot = Symbol.for("laratype.http.contractPolicies");
const brand = Symbol.for("laratype.auth.contractPolicyChecks");
const branded = (checks: ContractPolicyChecks): ContractPolicyChecks =>
  Object.defineProperty(checks, brand, { value: true });

const checksOf = (name: string): ContractPolicyChecks => ({
  async check(policy, user, ability, ...args) { void [policy, user, ability, args]; return true; },
  async authorize(policy, user, ability, ...args) { void [policy, user, ability, args]; },
});

const apiOf = (contract: AnyContract, name = "users") =>
  defineApi({ [name]: { contract, path: `/${name}`, scopes: [] } });

class UserController extends Controller {
  index() {
    return { ok: true };
  }
}

/** A policy the proof accepts for an `.authorize()` endpoint: the mount check only needs it mounted. */
class AnyPolicy {
  before() { return null; }
}

const mount = (routes: ApiRoutes) => routes.mount(new Hono());

const permissiveAuth = () => defineMiddleware<{ user?: unknown }>((_request, next) => next());
if (!(globalThis as Record<symbol, unknown>)[Symbol.for("laratype.http.contractAuth")]) registerContractAuth(permissiveAuth);

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[slot];
});

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[slot];
});

describe("the contract policy slot", () => {
  it("fails mount() closed when a route declares authorize and no checks are registered", () => {
    const guarded = defineContract()({ index: endpoint.get("/").auth().authorize().response(anything) });
    const routes = Route.api(apiOf(guarded), (r) => [r.contract(guarded, UserController, { policy: AnyPolicy })]);
    expect(() => mount(routes)).toThrow(
      "[@laratype/http] Route.api: users.index: the contract declares authorize, but @laratype/auth is not imported.",
    );
  });

  it('treats a slot value that is not a complete { check, authorize } as "not imported"', () => {
    for (const value of [42, null, {}, { check: 1, authorize: 1 }, { check: async () => true }]) {
      (globalThis as Record<symbol, unknown>)[slot] = value;
      expect(contractPolicies()).toBeUndefined();
      const guarded = defineContract()({ index: endpoint.get("/").auth().authorize().response(anything) });
      const routes = Route.api(apiOf(guarded), (r) => [r.contract(guarded, UserController, { policy: AnyPolicy })]);
      expect(() => mount(routes)).toThrow("the contract declares authorize, but @laratype/auth is not imported.");
    }
  });

  it("accepts the same checks twice and refuses a different unbranded value", () => {
    const checks = checksOf("a");
    registerContractPolicies(checks);
    expect(contractPolicies()).toBeDefined();
    expect(() => registerContractPolicies(checks)).not.toThrow();
    expect(() => registerContractPolicies(checksOf("b"))).toThrow(
      /registerContractPolicies\(\): the contract policy checks are already registered/,
    );
  });

  it("lets a branded value replace another branded one: last wins, and the second one is used", () => {
    const first = branded(checksOf("first"));
    const second = branded(checksOf("second"));
    registerContractPolicies(first);
    expect(() => registerContractPolicies(second)).not.toThrow();
    expect(contractPolicies()!.check).toBe(second.check);
    expect(contractPolicies()!.authorize).toBe(second.authorize);
  });

  it("refuses a branded value over an unbranded function and the reverse", () => {
    const plain = checksOf("plain");
    registerContractPolicies(plain);
    expect(() => registerContractPolicies(branded(checksOf("branded")))).toThrow(/already registered/);
    delete (globalThis as Record<symbol, unknown>)[slot];
    const marked = branded(checksOf("marked"));
    registerContractPolicies(marked);
    expect(() => registerContractPolicies(checksOf("other"))).toThrow(/already registered/);
  });

  it("replaces an incomplete slot value: it is not a registration", () => {
    (globalThis as Record<symbol, unknown>)[slot] = { check: 42 };
    const checks = checksOf("replacement");
    expect(() => registerContractPolicies(checks)).not.toThrow();
    expect(contractPolicies()!.check).toBe(checks.check);
  });

  it("reads the two functions once and snapshots them: a flipping getter cannot answer validation and requests differently", async () => {
    let reads = 0;
    const first = checksOf("first");
    const value = {
      get check() {
        reads++;
        return reads === 1 ? first.check : undefined;
      },
      get authorize() {
        return first.authorize;
      },
    } as ContractPolicyChecks;
    registerContractPolicies(value);
    const registered = contractPolicies()!;
    expect(registered.check).toBe(first.check);
    // A later read of the source (or a new getter answer) cannot change the registration
    expect(registered.check).toBe(first.check);
    expect(reads).toBe(1);
  });

  it("rejects a value that is not an object with both members, with the documented text", () => {
    for (const value of [undefined, null, 42, "checks", [], { check: 1, authorize: 1 }, { check: async () => true }]) {
      expect(() => registerContractPolicies(value as never)).toThrow(
        /^\[@laratype\/http\] registerContractPolicies\(\): expected \{ check, authorize \} from @laratype\/auth, got /,
      );
    }
  });

  it("does not call the checks for a public route", () => {
    let called = 0;
    registerContractPolicies({
      async check() { called++; return true; },
      async authorize() { called++; },
    });
    const open = defineContract()({ index: endpoint.get("/").public().response(anything) });
    mount(Route.api(apiOf(open), (r) => [r.contract(open, UserController)]));
    expect(called).toBe(0);
  });
});
