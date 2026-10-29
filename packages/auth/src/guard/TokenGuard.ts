import type { Request } from "@laratype/http";
import type { Model } from "@laratype/database";
import { Hash, ModelManagement, InternalException } from "@laratype/support";
import JWTVerification from "../verifications/jwt";
import UnsupportedVerificationModeException from "../exceptions/UnsupportVerificationModeException";
import type { GuardConfig } from "./tokens";

const ALIAS = "user";

/** Checked when no user matches, so an unknown user takes as long as a wrong password. */
let unknownUserHash: string | undefined;

/** A value a lookup can compare in the query: a string, a boolean, or a finite number. */
const isLookupValue = (value: unknown): value is string | boolean | number =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

/** The slice of a model a token lookup needs: its name and its primary column. */
interface PrimaryKeyModel {
  name: string;
  getRepository(): { metadata?: { primaryColumns?: { propertyName: string }[] } };
}

/** The primary key's property name: a model without one cannot be loaded by a token, so it is a configuration error. */
const primaryKeyOf = (model: PrimaryKeyModel): string => {
  const primaryKey = ModelManagement.getPrimaryKeyFromModel(model);
  if (!primaryKey) {
    throw new InternalException(`[@laratype/auth] Model ${model.name} does not have a primary key defined.`);
  }
  return primaryKey;
};

export type JWTSignOptions = {
  expiresIn?: number;
  name: string;
  abilities: string;
}

/**
 * A guard that authenticates a request by its bearer token, built by `AuthManager` from one entry of
 * `app/config/auth.ts` (A4 #151). Tokens are JWTs; with a PersonalAccessToken model, each token is also stored
 * and must have a live record.
 */
export default class TokenGuard<User = any> {

  constructor(
    /** The guard's key in `app/config/auth.ts`. */
    public readonly name: string,
    public readonly config: GuardConfig,
    /** The PersonalAccessToken model, when the app has one. */
    protected readonly tokenModel?: typeof Model,
  ) {}

  /** The bearer token of the request, read only through `request.bearerToken()` (A5 #288). */
  token(request: Request): string | undefined {
    return request.bearerToken() || undefined;
  }

  /** The user the request's bearer token belongs to, or `false`. */
  async user(request: Request): Promise<User | false> {
    const token = this.token(request);
    return token ? this.verify(token) : false;
  }

  /**
   * The user `token` belongs to, or `false` when it is unknown, expired, was issued for another guard or does not
   * verify. A provider model (or the token's model) without a primary key throws `InternalException`.
   */
  async verify(token: string): Promise<User | false> {
    let verificationMode: string = this.config.verification;
    let verifyRecord: any;

    if (this.tokenModel) {
      verifyRecord = await this.tokenModel.createQueryBuilder().where('token = :token and expires_at > :expires_at', {
        token,
        expires_at: new Date(),
      }).getOne();

      if (!verifyRecord) {
        return false;
      }

      verificationMode = verifyRecord.verification_type;
    }

    if (verificationMode !== 'jwt') {
      throw new UnsupportedVerificationModeException();
    }

    let decoded: any;
    try {
      decoded = await JWTVerification.verify(token);
    }
    catch (err) {
      return false;
    }

    // A token is signed for exactly one guard: a token issued by guard A never authenticates guard B (A6 #335)
    if (decoded.guard !== this.name) {
      return false;
    }

    if (!verifyRecord) {
      // Without a token record nothing can revoke the token, so its user is loaded by the id it carries
      const provider: typeof Model = this.config.provider;
      const primaryKey = primaryKeyOf(provider);
      // issueToken() signs the primary key's value under `payload.id`, whatever the column is called
      const id = decoded.payload?.id;
      if (id === undefined || id === null) {
        return false;
      }
      const user = await provider.findOneBy({ [primaryKey]: id } as any);
      return (user as User) ?? false;
    }

    // The record names the model the token was issued for, so its own primary key loads the user, not always `id`
    const modelResource = ModelManagement.getModelByName(verifyRecord.tokenable_type);
    if (!modelResource) {
      return false;
    }
    const user = await modelResource.findOneBy({
      [primaryKeyOf(modelResource)]: verifyRecord.tokenable_id,
    } as any);

    if (!user) {
      return false;
    }

    verifyRecord.last_used_at = new Date();
    await verifyRecord.save();

    return user as User;
  }

  /**
   * The user of the guard's provider model matching `fields`, or `null`. `fields` carries the guard's
   * `passwordField` (the model's `passwordField`, `password` by default): the user is looked up by the other fields
   * only, and the password is then checked with `Hash.check()`, since a salted hash can't be matched in the query.
   * A hash from an older format (0.5's sha256) is replaced on a successful login.
   */
  async attempt(fields: Record<string, any>): Promise<User | null> {
    const model: typeof Model = this.config.provider;
    // The model hashes its own credential column, so the guard must check the same one
    const declared: string | undefined = (model as { passwordField?: string }).passwordField;
    const passwordField: string = this.config.options?.passwordField ?? declared ?? "password";
    if (typeof declared === "string" && declared !== passwordField) {
      throw new Error(
        `[@laratype/auth] ${model.name} hashes "${declared}", not the guard's passwordField "${passwordField}": set static passwordField on the model, or use the same name in options.`,
      );
    }
    const { [passwordField]: password, ...where } = fields;
    // An object, an array, null or a non-finite number would reach the query as a value, not a credential
    const values = Object.values(where);
    if (typeof password !== "string" || values.length === 0 || values.some((value) => !isLookupValue(value))) {
      return null;
    }

    const column = model.getRepository().metadata.findColumnWithPropertyName(passwordField);
    if (!column) throw new Error(`[@laratype/auth] ${model.name} has no "${passwordField}" column (the guard's passwordField)`);
    // addSelect: the password column is usually { select: false }
    const user: any = await model.createQueryBuilder(ALIAS).where(where).addSelect(`${ALIAS}.${column.propertyPath}`).getOne();
    if (!user) {
      Hash.check(password, unknownUserHash ??= Hash.make(""));
      return null;
    }

    const hashed = user[passwordField];
    // The returned user has the shape a plain lookup gives: no hidden password column
    if (!column.isSelect) delete user[passwordField];
    if (!Hash.check(password, hashed)) return null;
    if (Hash.needsRehash(hashed)) {
      // A failed rehash must not fail the login: the stored hash still verifies, and this package has no logger to report it
      try {
        const rehashed = Hash.make(password);
        await model.getRepository().update(model.getId(user), { [passwordField]: rehashed });
        if (column.isSelect) user[passwordField] = rehashed;
      } catch {
        // swallowed on purpose
      }
    }
    return user;
  }

  /** Signs a token for `user`, and stores it when the app has a PersonalAccessToken model. */
  async issueToken(user: User, options: JWTSignOptions): Promise<string> {
    const fieldIdName = ModelManagement.getPrimaryKeyFromModelInstance(user as any);
    if (!fieldIdName) {
      throw new InternalException(`[@laratype/auth] Model ${(user as object).constructor.name} does not have a primary key defined.`);
    }
    const payload = {
      id: (user as any)[fieldIdName],
    };
    const expiresIn = options.expiresIn || 3600;
    const verificationMode = this.config.verification;
    let token: string | undefined;
    if (verificationMode === 'jwt') {
      token = await JWTVerification.sign({
        guard: this.name,
        payload: payload,
      }, {
        ...options,
        expiresIn,
      });
    }

    if (!token) {
      throw new UnsupportedVerificationModeException();
    }

    if (this.tokenModel) {
      await this.tokenModel.insert({
        tokenable_type: (user as object).constructor.name,
        tokenable_id: payload.id,
        name: options.name,
        abilities: options.abilities,
        token,
        verification_type: verificationMode,
        last_used_at: new Date(),
        expires_at: new Date(Date.now() + expiresIn * 1000),
      } as any);
    }

    return token;
  }
}
