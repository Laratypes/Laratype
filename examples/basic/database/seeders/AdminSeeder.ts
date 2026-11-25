import { Seeder } from "@laratype/database";
import { Env } from "@laratype/support";
import { RegisterBody } from "../../app/api/_schemas";
import Admin from "../../app/models/Admin";

/**
 * The first admin account of a fresh database. `POST /api/admin/register` is admin-only (an existing Admin creates
 * the next one), so a new install starts here: `ADMIN_EMAIL` and `ADMIN_PASSWORD` come from the environment or the
 * `.env` file, never from this file. `sauf db:seed --class AdminSeeder` is a no-op once that email exists.
 *
 * `ADMIN_PASSWORD` must fit `RegisterBody`'s password bounds: a value the login contract rejects would be stored as a
 * hash nobody can sign in with.
 *
 * The display columns are not credentials and keep their defaults; change the row afterwards if the example needs
 * another name or age.
 */
export default class AdminSeeder extends Seeder {
  public async run(): Promise<void> {
    const email = Env.get("ADMIN_EMAIL", "");
    const password = Env.get("ADMIN_PASSWORD", "");
    if (!email || !password) {
      throw new Error(
        "AdminSeeder: set ADMIN_EMAIL and ADMIN_PASSWORD (the first admin's credentials) in the environment or the .env file",
      );
    }

    // Check the bounds before the lookup, so a rerun with an existing admin fails on a value that could never sign in
    // instead of reporting success. `RegisterBody.shape.password` is the register credential schema the login contract
    // mirrors; the error names the variable and the bounds, never the value.
    const passwordSchema = RegisterBody.shape.password;
    if (!passwordSchema.safeParse(password).success) {
      throw new Error(
        `AdminSeeder: ADMIN_PASSWORD must be between ${passwordSchema.minLength} and ${passwordSchema.maxLength} characters`,
      );
    }

    const existing = await Admin.findOneBy({ email });
    if (existing) return;

    await Admin.save({ email, password, firstName: "Admin", lastName: "User", age: 18 });
  }
}
