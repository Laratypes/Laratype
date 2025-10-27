import { LaratypeConfig, getDefaultExports, getProjectPath, importModule, ModelManagement } from "@laratype/support";
import JWTVerification from "./jwt";
import UnsupportedVerificationModeException from "../exceptions/UnsupportVerificationModeException";
import { JwtVerification } from ".";

export type JWTSignOptions = {
  expiresIn?: number;
  name: string;
  abilities: string;
}

class GuardStore {

  static auth: LaratypeConfig.Auth;
  static ModelVerify: any;

  public static async getAuthConfig() {
    if(!this.auth) {
      const module: LaratypeConfig.Auth = await importModule(getProjectPath('config/auth.ts'))
      const authConfig = getDefaultExports(module)
      this.auth = authConfig;
    }

    return this.auth;
  }

  public static async getGuards() {
    const auth = await this.getAuthConfig();

    return auth.guards;
  }

  public static async getModelVerify() {
    if(!this.ModelVerify) {
      try {
        const { default: model } = await importModule("./src/models/PersonalAccessToken.ts");
        this.ModelVerify = model;
      }
      finally {
      }
    }
    return this.ModelVerify;
  }
}

class Verification {

  protected guardName: string;

  constructor(guardName: string) {
    this.guardName = guardName;
  }

  public async sign(payload: any, options: JWTSignOptions) {
    const isModel = payload.constructor && payload.constructor.dataSource
    let payload_ = { ...payload };
    const expiresIn = options.expiresIn || 3600;
    const guards = await GuardStore.getGuards();
    const guard = guards[this.guardName];
    if(!guard) {
      throw new Error(`Guard ${this.guardName} not found`);
    }
    const verificationMode = guard.verification;
    let token: string | undefined
    if(verificationMode === 'jwt') {
      // Reduce payload size for models
      if(isModel) {
        payload_ = {
          id: payload.id,
        }
      }

      token = await JWTVerification.sign({
        guard: this.guardName,
        payload: payload_,
      }, {
        ...options,
        expiresIn,
      })
    }

    if(!token) {
      throw new UnsupportedVerificationModeException()
    }

    if(isModel) {
      const modelName = payload.constructor.name;
      const ModelVerify = await GuardStore.getModelVerify();
      if(ModelVerify) {
        await ModelVerify.save({
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
    }

    return token;
  }

  public async verify(token: string) {
    try {
      const ModelVerify = await GuardStore.getModelVerify();

      const verifyRecord = await ModelVerify.createQueryBuilder().where('token = :token and expires_at > :expires_at', {
        token,
        expires_at: new Date(),
      }).getOne();

      if(!verifyRecord) {
        return false;
      }
      const verificationMode = verifyRecord.verification_type;

      let decoded: any
      if(verificationMode === 'jwt') {
        decoded = await JwtVerification.verify(token);
        this.guardName = decoded.guard;
      }
      else {
        throw new UnsupportedVerificationModeException()
      }
      if(ModelVerify) {
        const modelResource = ModelManagement.getModelByName(verifyRecord.tokenable_type);
        
        const user = await modelResource?.findOneBy({
          id: verifyRecord.tokenable_id,
        });

        if(!user) {
          return false;
        }

        verifyRecord.last_used_at = new Date();
        await ModelVerify.save(verifyRecord);

        return user;
      }
      return decoded;
    }
    catch (err) {
      return false;
    }
  }

}

export default class AuthVerification {

  public static guard(guardName: string) {
    return new Verification(guardName);
  }

  public static async sign(payload: any, options: JWTSignOptions): Promise<string> {
    const auth = await GuardStore.getAuthConfig();

    return this.guard(auth.default.guard).sign(payload, options);
  }

  public static async verify(token: string): Promise<any> {
    const auth = await GuardStore.getAuthConfig();
    return this.guard(auth.default.guard).verify(token);
  }

}
