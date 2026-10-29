import { AuthManager, PassportGuard } from "@laratype/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import Serve from "../../../packages/laratype/src/serve";
import { bootExample, type BootedExample } from "./support/boot";

// E5 #343: passport-google-oidc throws when its clientID is empty, so the example's Google guard skips registration
// without credentials outside production (the boot and the real-socket tests exercise that), and still fails the boot
// loudly in production.

describe("the Google guard", () => {
  let example: BootedExample | undefined;

  afterEach(async () => {
    await example?.stop();
    example = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not register the strategy when the credentials are missing outside production", async () => {
    vi.stubEnv("AUTH_GOOGLE_CLIENT_ID", "");
    vi.stubEnv("AUTH_GOOGLE_CLIENT_SECRET", "");

    example = await bootExample();

    // Without a strategy AuthManager builds a TokenGuard; a PassportGuard would construct the Google strategy at boot
    expect(Serve.getContainer().make(AuthManager).guard("api")).not.toBeInstanceOf(PassportGuard);
  });

  it("fails the boot in production when the credentials are missing", async () => {
    vi.stubEnv("AUTH_GOOGLE_CLIENT_ID", "");
    vi.stubEnv("AUTH_GOOGLE_CLIENT_SECRET", "");
    vi.stubGlobal("__PROD__", true);

    await expect(bootExample()).rejects.toThrow("OpenIDConnectStrategy requires a clientID option");
  });
});
