import { Enum } from "./Enum";

export class GeneralTypesEnum extends Enum {

  public static NOTHING = "";

  public static all() {
    return [
      GeneralTypesEnum.NOTHING
    ]
  }
}