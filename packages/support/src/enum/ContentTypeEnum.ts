import { Enum } from "./Enum";

export class ContentTypeEnum extends Enum {
  
  public static JSON: "application/json";
  public static HTML: "text/html";

  public static all() {
    return [
      this.JSON,
      this.HTML
    ]
  }
}