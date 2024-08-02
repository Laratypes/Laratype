import GeneralTypesEnum from "../enum/GeneralTypesEnum";
import JsonResource from "../resource/json/JsonResource";

export default class ResponseSerialization {

  public static jsonSerialize(data: any) {
    return JsonResource.toJson(data) as {};
  }

  public static htmlSerialize(data?: any): string {
    if(data === undefined || data === null) return GeneralTypesEnum.NOTHING
    if(typeof data === "string") return data
    return JSON.stringify(data)
  }
}