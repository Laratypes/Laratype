// The dummy-hash cache and the async check with custom Hashers; this file's guard module starts with a cold cache
import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import { Container, Facade, depsRegistry } from "@laratype/core";
import { Hasher } from "@laratype/support";
import { attempt, fakeModel } from "./fixtures/login";

/** Makes `hasher` the implementation the Hash facade resolves, as a provider binding does. */
const usingHasher = (hasher: Hasher) => {
  const app = new Container({ deps: depsRegistry });
  app.instance(Hasher, hasher);
  Facade.setFacadeApplication(app);
};

afterEach(() => Facade.setFacadeApplication(undefined));

describe("TokenGuard.attempt() with a custom Hasher", () => {
  it("retries a rejected dummy-hash build instead of caching the rejection", async () => {
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

    await expect(login()).rejects.toThrow("the hasher is down");
    await expect(login()).rejects.toThrow("the hasher is down");
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
    const { User } = fakeModel([{ id: 1, email: "ada@example.com", password: "stored" }]);

    expect(await attempt(User, { email: "ada@example.com", password: "secret" })).toBeNull();
    expect(hasher.calls).toBe(1);
  });
});
