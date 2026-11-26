import { afterEach, describe, expect, it, vi } from "vitest";
import Admin from "../app/models/Admin";
import AdminSeeder from "../database/seeders/AdminSeeder";

// E3 #135: the seeded admin password has to fit the credential schemas, or the login contract rejects every sign-in
// with the stored hash. The bounds come from `RegisterBody`, so the seeder cannot drift from the register routes.

const original = {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
};

const setCredentials = (password: string) => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = password;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of [
    ["ADMIN_EMAIL", original.email],
    ["ADMIN_PASSWORD", original.password],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("AdminSeeder", () => {
  it("rejects a password shorter than RegisterBody's minimum before the admin lookup", async () => {
    const lookup = vi.spyOn(Admin, "findOneBy");
    setCredentials("short-p"); // 7 characters, one under the register minimum

    await expect(new AdminSeeder().run()).rejects.toThrow(
      "ADMIN_PASSWORD must be between 8 and 128 characters",
    );
    // The bound is checked first: a rerun with an existing admin must not report success on an unusable password
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a password longer than the login maximum before the admin lookup, without printing it", async () => {
    const lookup = vi.spyOn(Admin, "findOneBy");
    const password = "p".repeat(129);
    setCredentials(password);

    const error = await new AdminSeeder().run().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("ADMIN_PASSWORD must be between 8 and 128 characters");
    expect((error as Error).message).not.toContain(password);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("saves the admin when the password fits the bounds", async () => {
    const password = "admin-password"; // 14 characters
    setCredentials(password);
    const lookup = vi.spyOn(Admin, "findOneBy").mockResolvedValue(null);
    const save = vi.spyOn(Admin, "save").mockResolvedValue({} as Admin);

    await new AdminSeeder().run();

    expect(lookup).toHaveBeenCalledWith({ email: "admin@example.com" });
    expect(save).toHaveBeenCalledWith({
      email: "admin@example.com",
      password,
      firstName: "Admin",
      lastName: "User",
      age: 18,
    });
  });
});
