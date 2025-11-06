import { type Model } from "@laratype/database"

export default class Authentication {

  public static login<T extends Model = any>(guard: any, fields: Record<string, any>): Promise<T> {
    const model: typeof Model = guard.provider
    
    const result = model.findOneBy(fields)
    
    return result;
  }
}