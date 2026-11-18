// The per-Hasher dummy-hash cache and the async check with custom Hashers
import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Container, Facade, depsRegistry } from "@laratype/core";
import { Hash, Hasher } from "@laratype/support";
import { SHA256_SECRET, attempt, fakeModel } from "./fixtures/login";

/** Makes `hasher` the implementation the Hash facade resolves, as a provider binding does. */
const usingHasher = (hasher: Hasher) => {
  const app = new Container({ deps: depsRegistry });
  app.instance(Hasher, hasher);
  Facade.setFacadeApplication(app);
};

/** A Hasher that records every check and derivation, so a test can count the scrypt work of a path. */
class RecordingHasher extends Hasher {
  checks: [string, string][] = [];
  makes: string[] = [];

  override async checkAsync(value: string, hashed: string): Promise<boolean> {
    this.checks.push([value, hashed]);
    return super.checkAsync(value, hashed);
  }

  override async makeAsync(value: string): Promise<string> {
    this.makes.push(value);
    return super.makeAsync(value);
  }
}

afterEach(() => Facade.setFacadeApplication(undefined));

describe("TokenGuard.attempt() with a custom Hasher", () => {
  it("answers a rejected dummy-hash build as an invalid credential, and builds it again next time", async () => {
    class Broken extends Hasher {
      calls = 0;
      override async makeAsync(): Promise<string> {
        this.calls += 1;
        throw new Error("the hasher is down");
      }
    }
    const hasher = new Broken();
    usingHasher(hasher);
    const { User } = fakeModel([]);
    const login = () => attempt(User, { email: "nobody@example.com", password: "secret" });

    // A failed build is dropped rather than cached, so a wrong password never turns into a 500
    await expect(login()).resolves.toBeNull();
    await expect(login()).resolves.toBeNull();
    expect(hasher.calls).toBe(2);
  });

  it("shares one pending dummy-hash build between concurrent unknown users", async () => {
    class Slow extends Hasher {
      calls = 0;
      override async makeAsync(value: string): Promise<string> {
        this.calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return super.makeAsync(value);
      }
    }
    const hasher = new Slow();
    usingHasher(hasher);
    const { User } = fakeModel([]);

    const [first, second] = await Promise.all([
      attempt(User, { email: "ada@example.com", password: "secret" }),
      attempt(User, { email: "bob@example.com", password: "secret" }),
    ]);
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(hasher.calls).toBe(1);
  });

  it("uses the Hasher bound at check time for the dummy hash", async () => {
    /** A Hasher whose dummy hashes carry its mark, so a check shows which binding built the hash it checked. */
    class Marked extends Hasher {
      checks: [string, string][] = [];
      makes: string[] = [];

      constructor(private readonly mark: string) {
        super();
      }

      override async makeAsync(value: string): Promise<string> {
        this.makes.push(value);
        return `${this.mark}:${value}`;
      }

      override async checkAsync(value: string, hashed: string): Promise<boolean> {
        this.checks.push([value, hashed]);
        return hashed === `${this.mark}:${value}`;
      }
    }
    const first = new Marked("first");
    const second = new Marked("second");
    usingHasher(first);
    const { User } = fakeModel([]);
    await expect(attempt(User, { email: "ada@example.com", password: "secret" })).resolves.toBeNull();
    expect(first.makes).toEqual([""]);
    expect(first.checks).toEqual([["secret", "first:"]]);

    // A swap must not reuse the old dummy: the next check builds and checks with the new binding
    usingHasher(second);
    await expect(attempt(User, { email: "bob@example.com", password: "secret" })).resolves.toBeNull();
    expect(second.makes).toEqual([""]);
    expect(second.checks).toEqual([["secret", "second:"]]);
    expect(first.checks).toHaveLength(1);

    // The cache is per binding: swapping back reuses the first binding's dummy instead of building another
    usingHasher(first);
    await expect(attempt(User, { email: "eve@example.com", password: "secret" })).resolves.toBeNull();
    expect(first.makes).toEqual([""]);
    expect(first.checks).toHaveLength(2);
  });

  it("shares one dummy hash between unknown users under the default binding", async () => {
    const make = vi.spyOn(Hasher.prototype, "makeAsync");
    const check = vi.spyOn(Hasher.prototype, "checkAsync");
    const { User } = fakeModel([]);
    await expect(attempt(User, { email: "ada@example.com", password: "secret" })).resolves.toBeNull();
    await expect(attempt(User, { email: "bob@example.com", password: "secret" })).resolves.toBeNull();
    // An unbound Hasher is a singleton: the second request reuses the dummy the first built, so it costs one derivation
    expect(make.mock.calls.filter(([value]) => value === "")).toHaveLength(1);
    expect(check).toHaveBeenCalledTimes(2);
    make.mockRestore();
    check.mockRestore();
  });

  it("denies a checkAsync answer that is truthy but not true", async () => {
    class Truthy extends Hasher {
      calls = 0;
      override async checkAsync(): Promise<boolean> {
        this.calls += 1;
        return "yes" as unknown as boolean;
      }
    }
    const hasher = new Truthy();
    usingHasher(hasher);
    // A current-format hash: only the explicit-true rule is under test, not a rehash or a dummy check
    const { User } = fakeModel([{ id: 1, email: "ada@example.com", password: Hash.make("stored") }]);

    expect(await attempt(User, { email: "ada@example.com", password: "secret" })).toBeNull();
    expect(hasher.calls).toBe(1);
  });
});

describe("TokenGuard.attempt() with a legacy stored hash", () => {
  it("pays one dummy check for a wrong password, as an unknown user does", async () => {
    const hasher = new RecordingHasher();
    usingHasher(hasher);
    const { User, calls } = fakeModel([{ id: 1, email: "old@example.com", password: SHA256_SECRET }]);

    expect(await attempt(User, { email: "old@example.com", password: "wrong" })).toBeNull();
    // The dummy check runs the scrypt derivation, then the 0.5 hash is compared without one
    expect(hasher.checks).toHaveLength(2);
    expect(hasher.checks[0]![0]).toBe("wrong");
    expect(Hash.isHashed(hasher.checks[0]![1])).toBe(true);
    expect(hasher.checks[1]).toEqual(["wrong", SHA256_SECRET]);
    expect(calls.update).toEqual([]);
  });

  it("logs in and rehashes a correct legacy password, after the same dummy check", async () => {
    const hasher = new RecordingHasher();
    usingHasher(hasher);
    const rows = [{ id: 1, email: "old@example.com", password: SHA256_SECRET }];
    const { User, calls } = fakeModel(rows);

    expect(await attempt(User, { email: "old@example.com", password: "secret" })).toEqual({
      id: 1,
      email: "old@example.com",
    });
    // One dummy check, then the real one; makeAsync() builds the dummy hash once and the new hash once
    expect(hasher.checks).toHaveLength(2);
    expect(Hash.isHashed(hasher.checks[0]![1])).toBe(true);
    expect(hasher.checks[1]).toEqual(["secret", SHA256_SECRET]);
    expect(hasher.makes).toContainEqual("secret");
    expect(calls.update).toHaveLength(1);
    expect(Hash.isHashed(rows[0]!.password)).toBe(true);
    expect(Hash.check("secret", rows[0]!.password)).toBe(true);
  });
});
