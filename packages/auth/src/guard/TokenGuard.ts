import type { Request } from "@laratype/http";
import type { Model } from "@laratype/database";
import { Hash, ModelManagement, InternalException } from "@laratype/support";
import JWTVerification from "../verifications/jwt";
import UnsupportedVerificationModeException from "../exceptions/UnsupportVerificationModeException";
import type { GuardConfig } from "./tokens";

const ALIAS = "user";

/** The pending dummy hash checked when no user matches, so an unknown user takes as long as a wrong password. */
let unknownUserHash: Promise<string> | undefined;

/** The dummy hash, built once; a rejected build is dropped so the next unknown-user request retries it. */
const dummyHash = () => {
  unknownUserHash ??= Hash.makeAsync("").catch((error) => {
    unknownUserHash = undefined;
    throw error;
  });
  return unknownUserHash;
};

/** A value a lookup can compare in the query: a string, a boolean, or a finite number. */
const isLookupValue = (value: unknown): value is string | boolean | number =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

/** One primary column: `propertyPath` nests a column inside an embed (`data.region`). */
interface PrimaryColumn {
  propertyName: string;
  propertyPath?: string;
}

/** The slice of a model a token lookup and the rehash update need: its name and its primary columns. */
interface PrimaryKeyModel {
  name: string;
  getRepository(): {
    metadata?: {
      primaryColumns?: PrimaryColumn[];
      /** The primary columns' values of one row; a null part stays in the map, a missing one drops it. */
      getEntityIdMap?(row: unknown): Record<string, unknown> | undefined;
    };
  };
}

/** The primary key's property name: a model without one cannot be loaded by a token, so it is a configuration error. */
const primaryKeyOf = (model: PrimaryKeyModel): string => {
  const primaryKey = ModelManagement.getPrimaryKeyFromModel(model);
  if (!primaryKey) {
    throw new InternalException(`[@laratype/auth] Model ${model.name} does not have a primary key defined.`);
  }
  return primaryKey;
};

/** A primary column's value in the id map: an embed nests its columns under the embed's property (`{ data: { region } }`). */
const idPart = (id: Record<string, unknown>, column: PrimaryColumn): unknown => {
  let value: unknown = id;
  for (const key of (column.propertyPath ?? column.propertyName).split(".")) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
};

/**
 * The criteria naming one row by every primary column, or `undefined` when the model has no primary key, the row is
 * missing part of its key, or a part is null. A composite key's `model.getId()` is an object, so only the id map names
 * the row.
 */
const primaryKeyWhere = (model: PrimaryKeyModel, row: unknown): Record<string, unknown> | undefined => {
  const metadata = model.getRepository().metadata;
  // An update without a primary column would match every row the other criteria match
  if (!metadata?.primaryColumns?.length) return undefined;
  const id = metadata.getEntityIdMap?.(row);
  if (!id) return undefined;
  // TypeORM keeps a null part in the id map, and `= NULL` matches no row (or another shape may match another row)
  if (metadata.primaryColumns.some((column) => {
    const part = idPart(id, column);
    return part === null || part === undefined;
  })) {
    return undefined;
  }
  return id;
};

/**
 * The one dummy check every login path pays, so its duration only depends on the password, not the account. A rejected
 * build answers as a wrong password and is dropped, so the next request builds it again.
 */
const payDummyCheck = async (password: string): Promise<void> => {
  try {
    await Hash.checkAsync(password, await dummyHash());
  } catch {
    // swallowed on purpose: the dummy check evens out the timing and never decides the login
  }
};

/** Whether a token record's model is one the guard loads: the provider itself, or a subclass of it. */
const isProviderModel = (model: unknown, provider: unknown): boolean => {
  if (model === provider) return true;
  return typeof model === "function" && typeof provider === "function" && model.prototype instanceof provider;
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
   * The user `token` belongs to, or `false` when it is unknown, expired, was issued for another guard or model, or
   * does not verify. A provider model (or the token's model) without a primary key throws `InternalException`.
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

    const provider: typeof Model = this.config.provider;
    // A token names the model it was signed for (A6 #335): the provider itself without a token record, the record's
    // own model with one, so another model's token never authenticates this guard
    const type = decoded.payload?.type;

    if (!verifyRecord) {
      if (type !== provider.name) {
        return false;
      }
      // Without a token record nothing can revoke the token, so its user is loaded by the id it carries
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
    // A record of another model would load a different identity than the guard's provider, and the signed model must be
    // the record's (A6 #335)
    if (!modelResource || !isProviderModel(modelResource, provider) || type !== verifyRecord.tokenable_type) {
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
   * only, and the password is then checked with `Hash.checkAsync()`, since a salted hash can't be matched in the
   * query and scrypt stays off the event loop. A hash from an older format (0.5's sha256) is replaced on a
   * successful login. Every path costs at least one scrypt derivation: an unknown user, or a user whose stored hash is
   * a 0.5 sha256 or unparseable, also runs a dummy check (see `payDummyCheck()`).
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
      // Concurrent unknown users share one derivation, and the check still costs one derivation, as a wrong password does
      await payDummyCheck(password);
      return null;
    }

    const hashed = user[passwordField];
    const needsRehash = Hash.needsRehash(hashed);
    // The returned user has the shape a plain lookup gives: no hidden password column
    if (!column.isSelect) delete user[passwordField];
    // A 0.5 sha256 or unparseable stored hash is checked without scrypt: pay one derivation, so a wrong password for
    // such a user costs as much as an unknown user's, and the timing does not show the account's hash is a legacy one
    if (needsRehash) await payDummyCheck(password);
    // Only an explicit boolean true logs in, so a custom Hasher cannot pass a truthy value off as a check
    if ((await Hash.checkAsync(password, hashed)) !== true) return null;
    if (needsRehash) {
      // A failed rehash must not fail the login: the stored hash still verifies, and this package has no logger to report it
      try {
        // Every primary column names the row: a composite key's value is an object, which one column cannot hold
        const key = primaryKeyWhere(model, user);
        // An update without the whole key could rewrite another row, or fail to match this one
        if (key) {
          const rehashed = await Hash.makeAsync(password);
          // Only replace the hash that was checked: a password reset that commits while scrypt runs keeps its newer hash
          const { affected } = await model.getRepository().update(
            { ...key, [passwordField]: hashed },
            { [passwordField]: rehashed },
          );
          // Only a reported one-row update is persisted: drivers that leave `affected` undefined may not have matched
          if (column.isSelect && affected === 1) user[passwordField] = rehashed;
        }
      } catch {
        // swallowed on purpose
      }
    }
    return user;
  }

  /** Signs a token for `user`, and stores it when the app has a PersonalAccessToken model. */
  async issueToken(user: User, options: JWTSignOptions): Promise<string> {
    const provider: typeof Model = this.config.provider;
    // Another model is refused where the token is signed (A6 #335). Without a token record, verify() loads the
    // provider's row by the signed id, so only the provider itself is accepted: a subclass with its own table would
    // load a different row. A token record names the user's own model, so a subclass of the provider is accepted there.
    const accepted = this.tokenModel ? user instanceof provider : (user as object | null)?.constructor === provider;
    if (!accepted) {
      const modelName = (user as { constructor?: { name?: string } } | null | undefined)?.constructor?.name ?? String(user);
      throw new InternalException(
        `[@laratype/auth] Guard "${this.name}" issues tokens for ${provider.name}, not ${modelName}.`,
      );
    }
    const fieldIdName = ModelManagement.getPrimaryKeyFromModelInstance(user as any);
    if (!fieldIdName) {
      throw new InternalException(`[@laratype/auth] Model ${(user as object).constructor.name} does not have a primary key defined.`);
    }
    const payload = {
      id: (user as any)[fieldIdName],
      // verify() compares it with the provider (no token record) or the record's tokenable_type (A6 #335)
      type: (user as object).constructor.name,
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
