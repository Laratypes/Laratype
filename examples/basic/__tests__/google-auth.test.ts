import { AuthManager, PassportGuard } from "@laratype/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import Serve from "../../../packages/laratype/src/serve";
import { bootExample, type BootedExample } from "./support/boot";

// E5 #343: passport-google-oidc throws when its clientID is empty, so the example's Google guard skips registration
// without credentials outside production (the boot and the real-socket tests exercise that), and still fails the boot
// loudly in production. The guard is registered again when both credentials are present. Skipping the strategy never
// skips the auth check: the protected route still answers 401 and the Google route fails closed.

const missingCredentials = "AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET are required in production";

const apiGuard = () => Serve.getContainer().make(AuthManager).guard("api");

const stubGoogleCredentials = (clientID: string, clientSecret: string) => {
  vi.stubEnv("AUTH_GOOGLE_CLIENT_ID", clientID);
  vi.stubEnv("AUTH_GOOGLE_CLIENT_SECRET", clientSecret);
};

describe("the Google guard", () => {
  let example: BootedExample | undefined;

  afterEach(async () => {
    await example?.stop();
    example = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not register the strategy when the credentials are missing in development", async () => {
    vi.stubGlobal("__PROD__", false);
    stubGoogleCredentials("", "");

    example = await bootExample();

    // Without a strategy AuthManager builds a TokenGuard; a PassportGuard would construct the Google strategy at boot
    expect(apiGuard()).not.toBeInstanceOf(PassportGuard);
  });

  it("registers the strategy when both credentials are present", async () => {
    vi.stubGlobal("__PROD__", false);
    stubGoogleCredentials("test-client-id", "test-client-secret");

    example = await bootExample();

    expect(apiGuard()).toBeInstanceOf(PassportGuard);
  });

  it("still refuses a protected route and a Google route without the credentials", async () => {
    vi.stubGlobal("__PROD__", false);
    stubGoogleCredentials("", "");

    example = await bootExample();

    // The auth check itself is never weakened: no token, no access
    expect((await example.app.request("/api/me")).status).toBe(401);
    // The Google route never answers 200 without its strategy (the wrapper throws before it can authenticate)
    expect([401, 500]).toContain((await example.app.request("/api/callback")).status);
  });

  it("fails the boot in production when the credentials are missing", async () => {
    vi.stubGlobal("__PROD__", true);
    stubGoogleCredentials("", "");

    await expect(bootExample()).rejects.toThrow(missingCredentials);
  });

  it("fails the boot in production when only one credential is missing", async () => {
    vi.stubGlobal("__PROD__", true);
    stubGoogleCredentials("test-client-id", "");

    await expect(bootExample()).rejects.toThrow(missingCredentials);
  });

  it("treats an environment with no NODE_ENV or APP_ENV as production", async () => {
    vi.stubGlobal("__PROD__", undefined);
    vi.stubEnv("NODE_ENV", "");
    vi.stubEnv("APP_ENV", "");
    stubGoogleCredentials("", "");

    await expect(bootExample()).rejects.toThrow(missingCredentials);
  });
});
