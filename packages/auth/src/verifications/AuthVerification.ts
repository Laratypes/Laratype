import { ModelManagement, InternalException } from "@laratype/support";
import JWTVerification from "./jwt";
import UnsupportedVerificationModeException from "../exceptions/UnsupportVerificationModeException";
import { JwtVerification } from ".";
import { Model } from "@laratype/database";
import { GuardStore } from "../passport/PassportServiceProvider";

export type JWTSignOptions = {
  expiresIn?: number;
  name: string;
  abilities: string;
}

export class Authenticated<T extends Model = any> {

  private user: T;
  protected guard: any;
  protected guardName: string;

  constructor(user: T, guard: any, guardName: string) {
    this.user = user;
    this.guard = guard;
    this.guardName = guardName;
  }

  async generateToken(options: JWTSignOptions) {
    const fieldIdName = ModelManagement.getPrimaryKeyFromModelInstance(this.user);
    if(!fieldIdName) {
      throw new InternalException(`Model ${this.user.constructor.name} does not have a primary key defined.`)
    }
    const payload = {
      // @ts-ignore
      id: this.user[fieldIdName],
    };
    const expiresIn = options.expiresIn || 3600;
    const verificationMode = this.guard.verification;
    let token: string | undefined
    if (verificationMode === 'jwt') {
      token = await JWTVerification.sign({
        guard: this.guardName,
        payload: payload,
      }, {
        ...options,
        expiresIn,
      })
    }

    if (!token) {
      throw new UnsupportedVerificationModeException()
    }

    const modelName = payload.constructor.name;
    const ModelVerify = GuardStore.getModelVerify();
    if (ModelVerify) {
      await ModelVerify.insert({
        tokenable_type: modelName,
        tokenable_id: payload.id,
        name: options.name,
        abilities: options.abilities,
        token,
        verification_type: verificationMode,
        last_used_at: new Date(),
        expires_at: new Date(Date.now() + expiresIn * 1000),
      });
    }

    return token;
  }

  getUser(): T {
    return this.user;
  }
}

class Verification {

  protected guardName: string;

  constructor(guardName: string) {
    this.guardName = guardName;
  }

  public async verify(token: string) {
    const ModelVerify = await GuardStore.getModelVerify();

    const verifyRecord = await ModelVerify.createQueryBuilder().where('token = :token and expires_at > :expires_at', {
      token,
      expires_at: new Date(),
    }).getOne();

    if (!verifyRecord) {
      return false;
    }
    const verificationMode = verifyRecord.verification_type;

    let decoded: any
    if (verificationMode === 'jwt') {
      try {
        decoded = await JwtVerification.verify(token);
      }
      catch (err) {
        return false;
      }
      this.guardName = decoded.guard;
    }
    else {
      throw new UnsupportedVerificationModeException()
    }
    if (ModelVerify) {
      const modelResource = ModelManagement.getModelByName(verifyRecord.tokenable_type);

      const user = await modelResource?.findOneBy({
        id: verifyRecord.tokenable_id,
      });

      if (!user) {
        return false;
      }

      verifyRecord.last_used_at = new Date();
      await verifyRecord.save();

      return user;
    }

    return decoded;
  }

}

export default class AuthVerification {

  public static guard(guardName: string) {
    return new Verification(guardName);
  }

  public static verify(token: string): Promise<any> {
    const auth = GuardStore.getAuthConfig();
    return this.guard(auth.default.guard).verify(token);
  }

}
